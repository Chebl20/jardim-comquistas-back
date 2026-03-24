const fs = require('fs');
const path = require('path');

const collectionPath = path.join(__dirname, 'postman_collection.json');
const collectionData = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

// Find Dashboard folder
const dashboardFolder = collectionData.item.find(i => i.name === 'Dashboard');
if (dashboardFolder) {
  // Replace its items with the new unified endpoint
  dashboardFolder.item = [
    {
      name: 'GET /api/dashboard',
      request: {
        method: 'GET',
        header: [
          { key: 'Authorization', value: 'Bearer {{token}}', type: 'text' }
        ],
        url: {
          raw: '{{baseUrl}}/api/dashboard?period=day&date=2024-10-15',
          host: ['{{baseUrl}}'],
          path: ['api', 'dashboard'],
          query: [
            { key: 'period', value: 'day', description: 'day, week ou month' },
            { key: 'date', value: '2024-10-15' }
          ]
        }
      }
    }
  ];
}

fs.writeFileSync(collectionPath, JSON.stringify(collectionData, null, 2), 'utf8');
console.log('Postman collection updated for dashboard endpoint.');
