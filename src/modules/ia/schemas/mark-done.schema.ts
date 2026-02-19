const markDoneSchema = {
  $id: 'MARK_DONE',
  type: 'object',
  properties: {
    action: {
      type: 'object',
      properties: {
        intent: { const: 'MARK_DONE' },
        data: {
          type: 'object',
          properties: {
            goalId: { type: 'string' },
            userId: { type: 'string' }
          },
          required: ['goalId']
        }
      },
      required: ['intent','data']
    }
  },
  required: ['action']
};

export default markDoneSchema;
