const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Função para normalizar goalType para goalKind
function normalizeGoalType(goalType) {
  if (!goalType) return 'CONTINUA';
  const normalized = goalType.toUpperCase();
  return normalized === 'PONTUAL' ? 'PONTUAL' : 'CONTINUA';
}

// Função para extrair dados do scheduleConfig
function extractScheduleData(scheduleConfig) {
  if (!scheduleConfig) return null;
  
  try {
    const config = typeof scheduleConfig === 'string' ? JSON.parse(scheduleConfig) : scheduleConfig;
    return config;
  } catch (e) {
    console.error('Erro ao parsear scheduleConfig:', scheduleConfig, e);
    return null;
  }
}

async function migrateBackup() {
  console.log('Iniciando migração do backup...');
  
  try {
    // Ler o arquivo de backup convertido para UTF-8
    const backupPath = path.join(__dirname, '../database/backup_utf8.sql');
    const content = fs.readFileSync(backupPath, 'utf8');
    
    // Encontrar a seção de dados do UserGoal
    const lines = content.split('\n');
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
    
    // Migrar cada UserGoal para o novo modelo
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
      
      try {
        // Criar Goal no novo modelo
        const goalData = {
          id: id,
          userId: userId,
          title: title,
          description: description === '\\N' ? null : description,
          conquestType: conquestType,
          goalKind: normalizeGoalType(goalType),
          status: completed === 't' ? 'COMPLETED' : 'ACTIVE',
          plantedTreeId: plantedTreeId === '\\N' ? null : plantedTreeId,
          reminderTime: reminderTime === '\\N' ? null : new Date(reminderTime),
          scheduleConfig: scheduleConfig === '\\N' ? null : extractScheduleData(scheduleConfig),
          reminderSlotsToday: reminderSlotsToday === '\\N' ? null : reminderSlotsToday,
          lastReminderSentAt: lastReminderSentAt === '\\N' ? null : new Date(lastReminderSentAt),
          reminderCount: reminderCount === '\\N' ? 0 : parseInt(reminderCount),
          dailyStatus: dailyStatus === '\\N' ? null : dailyStatus,
          silenceUntil: silenceUntil === '\\N' ? null : new Date(silenceUntil),
          completed: completed === 't',
          createdAt: new Date(createdAt),
          updatedAt: new Date(updatedAt)
        };
        
        const goal = await prisma.goal.create({ data: goalData });
        
        // Se tiver scheduleConfig, criar GoalSchedule
        const scheduleData = extractScheduleData(scheduleConfig);
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
              rrule: null, // Poderia ser gerado a partir do scheduleConfig
              extra: scheduleData
            }
          });
        }
        
        console.log(`Migrado com sucesso: ${title} (${goalType} → ${goalData.goalKind})`);
        
      } catch (error) {
        console.error(`Erro ao migrar UserGoal ${id}:`, error);
      }
    }
    
    console.log('Migração concluída com sucesso!');
    
  } catch (error) {
    console.error('Erro durante a migração:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar migração
migrateBackup();
