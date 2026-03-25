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

async function migrateBackup() {
  console.log('🚀 Iniciando migração do backup...');
  
  try {
    // Primeiro, verificar quais PlantedTree existem
    const existingPlantedTrees = await prisma.plantedTree.findMany({
      select: { id: true }
    });
    const plantedTreeIds = new Set(existingPlantedTrees.map(pt => pt.id));
    console.log(`Encontradas ${plantedTreeIds.size} PlantedTrees no banco`);
    
    // Ler o arquivo de backup
    const backupPath = path.join(__dirname, '../database/backup_utf8.sql');
    const content = fs.readFileSync(backupPath, 'utf8');
    const lines = content.split('\n');
    
    // Encontrar dados do UserGoal
    let inUserGoalSection = false;
    let userGoalData = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.includes('COPY public."UserGoal"')) {
        inUserGoalSection = true;
        continue;
      }
      
      if (inUserGoalSection && line === '\\.') {
        break;
      }
      
      if (inUserGoalSection && line && !line.startsWith('--')) {
        userGoalData.push(line);
      }
    }
    
    console.log(`Encontrados ${userGoalData.length} registros de UserGoal para migrar`);
    
    let successCount = 0;
    let skippedCount = 0;
    
    // Migrar cada UserGoal
    for (const dataLine of userGoalData) {
      const fields = dataLine.split('\t');
      
      if (fields.length < 19) {
        console.warn('Linha com campos insuficientes:', dataLine);
        continue;
      }
      
      const [
        id,
        userId,
        title,
        description,
        goalType,
        conquestType,
        frequency,
        reminderTime,
        completed,
        plantedTreeId,
        createdAt,
        updatedAt,
        anchorId,
        lastReminderSentAt,
        dailyStatus,
        silenceUntil,
        reminderCount,
        reminderSlotsToday,
        scheduleConfig
      ] = fields;
      
      // Verificar se a PlantedTree referenciada existe
      const treeId = parseValue(plantedTreeId);
      if (treeId && !plantedTreeIds.has(treeId)) {
        console.warn(`⚠️  Pulando Goal "${title}" - PlantedTree ${treeId} não encontrada`);
        skippedCount++;
        continue;
      }
      
      try {
        // Criar Goal no novo modelo
        const goalData = {
          id: id,
          userId: userId,
          title: title,
          description: parseValue(description),
          conquestType: conquestType,
          goalKind: normalizeGoalType(goalType),
          status: parseBoolean(completed) ? 'COMPLETED' : 'ACTIVE',
          plantedTreeId: treeId,
          reminderTime: parseDate(reminderTime),
          scheduleConfig: parseJson(scheduleConfig),
          reminderSlotsToday: parseJson(reminderSlotsToday),
          lastReminderSentAt: parseDate(lastReminderSentAt),
          reminderCount: parseValue(reminderCount) ? parseInt(parseValue(reminderCount)) : 0,
          dailyStatus: parseValue(dailyStatus),
          silenceUntil: parseDate(silenceUntil),
          completed: parseBoolean(completed),
          createdAt: parseDate(createdAt),
          updatedAt: parseDate(updatedAt)
        };
        
        const goal = await prisma.goal.create({ data: goalData });
        
        // Se tiver scheduleConfig, criar GoalSchedule
        const scheduleData = parseJson(scheduleConfig);
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
        
        console.log(`✅ Migrado: ${title} (${goalType} → ${goalData.goalKind})`);
        successCount++;
        
      } catch (error) {
        console.error(`❌ Erro ao migrar UserGoal ${id}:`, error.message);
      }
    }
    
    console.log(`\n📊 Resumo da migração:`);
    console.log(`✅ Sucesso: ${successCount} registros`);
    console.log(`⚠️  Pulados: ${skippedCount} registros (PlantedTree não encontrada)`);
    console.log(`📝 Total processado: ${userGoalData.length} registros`);
    console.log('\n🎉 Migração concluída!');
    
  } catch (error) {
    console.error('❌ Erro durante a migração:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar migração
migrateBackup();
