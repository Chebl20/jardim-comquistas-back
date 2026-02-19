const askInfoSchema = {
  $id: 'ASK_INFO',
  type: 'object',
  properties: {
    action: {
      type: 'object',
      properties: {
        intent: { const: 'ASK_INFO' },
        data: {
          type: 'object',
          properties: {
            missing: { type: 'string' },
            question: { type: 'string' },
            prompt: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } }
          },
          required: ['missing'],
          anyOf: [ { required: ['question'] }, { required: ['prompt'] } ]
        }
      },
      required: ['intent','data']
    }
  },
  required: ['action']
};

export default askInfoSchema;
