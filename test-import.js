const path = require('path');

// Try to require the module and log any errors
try {
    const helpers = require('./helpers/refundHelpers');
    console.log('Successfully imported refundHelpers:', helpers);
} catch (error) {
    console.error('Error importing refundHelpers:', error);
    
    // Log the current working directory
    console.log('Current working directory:', process.cwd());
    
    // Check if the file exists using fs
    const fs = require('fs');
    const filePath = path.join(__dirname, 'helpers', 'refundHelpers.js');
    console.log('Looking for file at:', filePath);
    console.log('File exists:', fs.existsSync(filePath));
    
    // Try to read the file directly
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        console.log('File content length:', content.length);
    } catch (readError) {
        console.error('Error reading file:', readError);
    }
}
