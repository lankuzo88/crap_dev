'use strict';

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Other configurations and routes

app.listen(PORT, '0.0.0.0', () => { // Changed from localhost to 0.0.0.0 for external access
    console.log(`Server running on 0.0.0.0:${PORT}`); // Updated log message
});

// Example of other log messages
console.log(`Access the dashboard at 0.0.0.0:${PORT}`); // Updated log message
console.log(`API is running on 0.0.0.0:${PORT}`); // Updated log message

// Your additional code here
