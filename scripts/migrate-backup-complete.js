const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

function parseValue(value) {
  if (value === '\\N' || value === 'NULL' || value === '') return null;
  return value;
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === '\\N') return null;
  return new Date(dateStr);
}

function parseBoolean(boolStr) {
  if (!boolStr || boolStr === '\\N') return false;
  return boolStr === 't' || boolStr === 'true';
}

function parseJson(jsonStr) {
  if (!jsonStr || jsonStr === '\\N') return null;
  try {
    return typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  } catch (e) {
    console.error('Erro ao parsear JSON:', jsonStr);
    return null;
  }
}

function normalizeGoalType(goalType) {
  if (!goalType) return 'CONTINUA';
  const normalized = goalType.toUpperCase();
  return normalized === 'PONTUAL' ? 'PONTUAL' : 'CONTINUA';
}

async function migrateTable(tableName, fields, processor) {
  console.log(`\n=== Migrando tabela: ${tableName} ===`);
  
  const backupPath = path.join(__dirname, '../database/backup_utf8.sql');
  const content = fs.readFileSync(backupPath, 'utf8');
  const lines = content.split('\n');
  
  let inTableSection = false;
  let tableData = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.includes(`COPY public."${tableName}"`)) {
      inTableSection = true;
      continue;
    }
    
    if (inTableSection && line === '\\.') {
      break;
    }
    
    if (inTableSection && line && !line.startsWith('--')) {
      tableData.push(line);
    }
  }
  
  console.log(`Encontrados ${tableData.length} registros em ${tableName}`);
  
  let successCount = 0;
  for (const dataLine of tableData) {
    const values = dataLine.split('\t');
    
    if (values.length < fields.length) {
      console.warn(`Linha com campos insuficientes em ${tableName}:`, dataLine);
      continue;
    }
    
    const record = {};
    fields.forEach((field, index) => {
      record[field] = values[index];
    });
    
    try {
      await processor(record);
      successCount++;
    } catch (error) {
      console.error(`Erro ao migrar registro em ${tableName}:`, error.message);
    }
  }
  
  console.log(`✅ ${tableName}: ${successCount}/${tableData.length} registros migrados com sucesso`);
  return successCount;
}

async function migrateBackup() {
  console.log('🚀 Iniciando migração completa do backup...');
  
  try {
    // 1. Migrar Users primeiro
    await migrateTable('User', ['id', 'name', 'email', 'password', 'linkCode', 'telegramId', 'timezone', 'currentWorldId', 'digestEnabled', 'digestTime', 'createdAt', 'updatedAt'], async (record) => {
      await prisma.user.create({
        data: {
          id: record.id,
          name: record.name,
          email: record.email,
          password: record.password,
          linkCode: parseValue(record.linkCode),
          telegramId: parseValue(record.telegramId),
          timezone: parseValue(record.timezone) || 'UTC',
          currentWorldId: parseValue(record.currentWorldId),
          digestEnabled: parseBoolean(record.digestEnabled),
          digestTime: parseValue(record.digestTime),
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt)
        }
      });
    });
    
    // 2. Migrar World
    await migrateTable('World', ['id', 'worldId', 'name', 'svgPath', 'createdAt', 'updatedAt'], async (record) => {
      await prisma.world.create({
        data: {
          id: record.id,
          worldId: record.worldId,
          name: record.name,
          svgPath: record.svgPath,
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt)
        }
      });
    });
    
    // 3. Migrar WorldConfig
    await migrateTable('WorldConfig', ['id', 'worldId', 'anchors', 'defaultTreeType', 'defaultGrowth', 'createdAt', 'updatedAt'], async (record) => {
      await prisma.worldConfig.create({
        data: {
          id: parseInt(record.id),
          worldId: record.worldId,
          anchors: parseJson(record.anchors),
          defaultTreeType: parseValue(record.defaultTreeType),
          defaultGrowth: record.defaultGrowth ? parseInt(record.defaultGrowth) : null,
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt)
        }
      });
    });
    
    // 4. Migrar TreeCatalog
    await migrateTable('TreeCatalog', ['id', 'family', 'type', 'stages', 'createdAt', 'updatedAt'], async (record) => {
      await prisma.treeCatalog.create({
        data: {
          id: record.id,
          family: record.family,
          type: record.type,
          stages: parseJson(record.stages),
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt)
        }
      });
    });
    
    // 5. Migrar PlantedTree
    await migrateTable('PlantedTree', ['id', 'worldId', 'anchorId', 'treeCatalogId', 'actualStage', 'createdAt', 'updatedAt'], async (record) => {
      await prisma.plantedTree.create({
        data: {
          id: record.id,
          worldId: record.worldId,
          anchorId: record.anchorId,
          treeCatalogId: record.treeCatalogId,
          actualStage: parseInt(record.actualStage),
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt)
        }
      });
    });
    
    // 6. Migrar GrowthEvent
    await migrateTable('GrowthEvent', ['id', 'plantedTreeId', 'stage', 'progressIndex', 'title', 'description', 'createdAt'], async (record) => {
      await prisma.growthEvent.create({
        data: {
          id: record.id,
          plantedTreeId: record.plantedTreeId,
          stage: parseInt(record.stage),
          progressIndex: parseInt(record.progressIndex),
          title: record.title,
          description: record.description,
          createdAt: parseDate(record.createdAt)
        }
      });
    });
    
    // 7. Migrar ConversationSession
    await migrateTable('ConversationSession', ['id', 'userId', 'state', 'meta', 'createdAt', 'updatedAt'], async (record) => {
      await prisma.conversationSession.create({
        data: {
          id: record.id,
          userId: record.userId,
          state: record.state,
          meta: parseJson(record.meta),
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt)
        }
      });
    });
    
    // 8. Por último, migrar UserGoal -> Goal
    await migrateTable('UserGoal', [
      'id', 'userId', 'title', 'description', 'goalType', 'conquestType', 
      'frequency', 'reminderTime', 'completed', 'plantedTreeId', 
      'createdAt', 'updatedAt', 'anchorId', 'lastReminderSentAt', 
      'dailyStatus', 'silenceUntil', 'reminderCount', 'reminderSlotsToday', 'scheduleConfig'
    ], async (record) => {
      const goalData = {
        id: record.id,
        userId: record.userId,
        title: record.title,
        description: parseValue(record.description),
        conquestType: record.conquestType,
        goalKind: normalizeGoalType(record.goalType),
        status: parseBoolean(record.completed) ? 'COMPLETED' : 'ACTIVE',
        plantedTreeId: parseValue(record.plantedTreeId),
        reminderTime: parseDate(record.reminderTime),
        scheduleConfig: parseJson(record.scheduleConfig),
        reminderSlotsToday: parseJson(record.reminderSlotsToday),
        lastReminderSentAt: parseDate(record.lastReminderSentAt),
        reminderCount: record.reminderCount ? parseInt(record.reminderCount) : 0,
        dailyStatus: parseValue(record.dailyStatus),
        silenceUntil: parseDate(record.silenceUntil),
        completed: parseBoolean(record.completed),
        createdAt: parseDate(record.createdAt),
        updatedAt: parseDate(record.updatedAt)
      };
      
      const goal = await prisma.goal.create({ data: goalData });
      
      // Criar GoalSchedule se tiver scheduleConfig
      const scheduleData = parseJson(record.scheduleConfig);
      if (scheduleData) {
        let frequency = 'ONCE';
        let dtStart = new Date();
        
        if (scheduleData.type === 'daily') {
          frequency = 'DAILY';
        } else if (scheduleData.type === 'weekly') {
          frequency = 'WEEKLY';
        } else if (scheduleData.type === 'monthly') {
          frequency = 'MONTHLY';
        }
        
        if (scheduleData.at) {
          dtStart = new Date(scheduleData.at);
        }
        
        await prisma.goalSchedule.create({
          data: {
            goalId: goal.id,
            frequency: frequency,
            dtStart: dtStart,
            rrule: null,
            extra: scheduleData
          }
        });
      }
    });
    
    console.log('\n🎉 Migração concluída com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro durante a migração:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar migração
migrateBackup();
