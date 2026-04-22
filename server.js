// Original content of server.js...

// Other content above line 380...
app.listen(PORT, "0.0.0.0", () => {
// Other content below line 380...

// Update all console output's localhost URLs to 0.0.0.0 URLs
console.log(`Server is running on http://0.0.0.0:${PORT}`);

// Additional console logs to replace
// Original console.log locations replaced with 0.0.0.0
