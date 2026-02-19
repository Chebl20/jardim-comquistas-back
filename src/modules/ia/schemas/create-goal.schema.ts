const createGoalSchema = {
  $id: 'CREATE_GOAL',
  type: 'object',
  properties: {
    action: {
      type: 'object',
      properties: {
        intent: { const: 'CREATE_GOAL' },
        data: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            goalType: { type: 'string' },
            conquestType: { type: 'string' },
            conquestConfidence: { type: 'number' },
            reminderTime: { type: 'string' },
            userId: { type: 'string' }
          },
          required: ['title']
        }
      },
      required: ['intent','data']
    }
  },
  required: ['action']
};

export default createGoalSchema;
