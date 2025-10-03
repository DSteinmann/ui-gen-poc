const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
const port = 3002;

let status = 'Off'; // Initial status

const thingDescription = {
  '@context': 'https://www.w3.org/2022/wot/td/v1.1',
  title: 'My Light Switch',
  properties: {
    status: {
      type: 'string',
      readOnly: true,
      forms: [{
        href: 'http://localhost:3002/properties/status'
      }]
    }
  },
  actions: {
    toggle: {
      forms: [{
        href: 'http://localhost:3002/toggle',
        contentType: 'application/json',
        op: 'invokeaction'
      }]
    }
  }
};

app.get('/thing-description', (req, res) => {
  const currentStatusThingDescription = { ...thingDescription };
  // Augment the TD with the current status before sending it
  currentStatusThingDescription.properties.status.description = `Current status is ${status}`;
  res.json(currentStatusThingDescription);
});

app.get('/properties/status', (req, res) => {
  res.json({ status });
});

app.post('/toggle', (req, res) => {
  console.log('Toggling light');
  status = status === 'Off' ? 'On' : 'Off';
  console.log(`Status is now: ${status}`);
  res.json({ success: true, status });
});

app.listen(port, () => {
  console.log(`External Thing server listening at http://localhost:${port}`);
});