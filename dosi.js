const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const https = require('https');
const app = express();
const port = 8443;

const serverOptions = {
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')), // Read cert from ./ directory
    key: fs.readFileSync(path.join(__dirname, 'key.pem')) // Read key from ./ directory
};

// Create an HTTPS server for serving HTML files
const httpsServer = https.createServer(serverOptions, app);

// Log file path
const logFilePath = path.join(__dirname, 'server.log');

// Function to log messages to the file
function logToFile(req, message) {
    let ip = 'N/A';
    if (req) {
        ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    }
    const logMessage = `[${new Date().toISOString()}] [IP: ${ip}] ${message}\n`;
    fs.appendFileSync(logFilePath, logMessage, 'utf8');
}

// Function to include the header and footer in response
function includeHeaderAndFooter(callback) {
    const headerPath = path.join(__dirname, 'header.html');
    const footerPath = path.join(__dirname, 'footer.html');

    fs.readFile(headerPath, 'utf8', (err, headerData) => {
        if (err) {
            console.error('Error reading header.html:', err);
            headerData = ''; // Fallback in case of error
        }
        fs.readFile(footerPath, 'utf8', (err, footerData) => {
            if (err) {
                console.error('Error reading footer.html:', err);
                footerData = ''; // Fallback in case of error
            }
            callback(headerData, footerData);
        });
    });
}

// Load credentials from credentials.json
const credentialsPath = path.join(__dirname, 'credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

// Directories for clients
const unknownClientsDir = path.join(__dirname, 'unknown_clients');
const adoptedClientsDir = path.join(__dirname, 'adopted_clients');

// Ensure the directories exist
if (!fs.existsSync(unknownClientsDir)) {
    fs.mkdirSync(unknownClientsDir);
}
if (!fs.existsSync(adoptedClientsDir)) {
    fs.mkdirSync(adoptedClientsDir);
}

// Set up session middleware
app.use(
    session({
        secret: 'your_secret_key', // Replace with a strong secret key
        resave: false,
        saveUninitialized: true,
    })
);

// Middleware for checking authentication
const checkAuth = (req, res, next) => {
    if (req.session.isAuthenticated) {
        next(); // User is authenticated, proceed to the next middleware or route
    } else {
        logToFile(req, 'Unauthorized access attempt.');
        res.send(`
            <html>
            <body>
                <h1>Unauthorized Access</h1>
                <p>You will be redirected to the login page in 3 seconds...</p>
                <script>
                    setTimeout(function() {
                        window.location.href = '/login';
                    }, 3000);
                </script>
            </body>
            </html>
        `);
    }
};

// Use Express's built-in body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve the login page
app.get('/login', (req, res) => {
    // Capture any error message from query parameters
    const error = req.query.error ? req.query.error : '';

    includeHeaderAndFooter((header, footer) => {
        res.send(`
        ${header.replace('<!-- HIDE_NAVIGATION_FLAG -->', 'hide-navigation')}
            <div class="login-container">
                <h1>Login</h1>
                <form action="/login" method="post">
                    <div class="input-group">
                        <input type="text" id="username" name="username" placeholder="Username" required>
                    </div>
                    <div class="input-group">
                        <input type="password" id="password" name="password" placeholder="Password" required>
                    </div>
                    <button type="submit" class="login-button">Login</button>
                </form>
                ${error ? `<div class="error-message">${error}</div>` : ''}
            </div>
            ${footer}
        `);
    });
});

// Handle login requests
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Check credentials against those in credentials.json
    if (username === credentials.username && password === credentials.password) {
        req.session.isAuthenticated = true;
        logToFile(req, `Successful login by user: ${username}`);
        res.redirect('/'); // Redirect to the home page after login
    } else {
        logToFile(req, `Failed login attempt with username: ${username}`);
        res.status(401).send('Invalid credentials. <br><a href="/login">Try again</a>');
    }
});

// Handle logout requests
app.get('/logout', (req, res) => {
    logToFile(req, 'User logged out.');
    req.session.destroy();
    includeHeaderAndFooter((header, footer) => {
        res.send(`
            <h1>Logged out successfully!</h1>
            <br><p>You will be redirected to the login page in 3 seconds...</p>
            <script>
                setTimeout(function() {
                    window.location.href = '/login';
                }, 3000);
            </script>`);
    });
});

// Serve the index page, protected by authentication
app.get('/', checkAuth, (req, res) => {
    const clients = [];
    const groupDirectories = fs.readdirSync(adoptedClientsDir).filter(group =>
        fs.lstatSync(path.join(adoptedClientsDir, group)).isDirectory()
    );

    // Gather all clients from each group
    groupDirectories.forEach(group => {
        const groupPath = path.join(adoptedClientsDir, group);
        const groupClients = fs.readdirSync(groupPath).filter(client =>
            fs.lstatSync(path.join(groupPath, client)).isDirectory()
        ).map(client => ({ group, client }));

        clients.push(...groupClients);
    });

    // Enhance each client with alias for sorting
    clients.forEach(client => {
        const clientDir = path.join(adoptedClientsDir, client.group, client.client);
        const aliasFile = path.join(clientDir, 'alias.txt');
        client.alias = fs.existsSync(aliasFile) ? fs.readFileSync(aliasFile, 'utf-8').trim() : '';
    });

    // Sort: clients without alias first, then by alias alphabetically
    clients.sort((a, b) => {
        if (!a.alias && b.alias) return -1;
        if (a.alias && !b.alias) return 1;
        return a.alias.localeCompare(b.alias);
    });

    includeHeaderAndFooter((header, footer) => {
        // Build the client table HTML with alternating row colors
        let clientTableHtml = `
            ${header}
            <meta http-equiv="refresh" content="15"> <!-- Auto-refresh every 15 seconds -->
            <h1>Welcome to the Device Operating System Injection (DOSI) Management Dashboard</h1>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #333; color: white;">
                        <th style="padding: 8px; text-align: left;">Device ID</th>
                        <th style="padding: 8px; text-align: left;">Status</th>
                        <th style="padding: 8px; text-align: left;">Last Seen</th>
                        <th style="padding: 8px; text-align: left;">Group</th>
                        <th style="padding: 8px; text-align: left;">Alias</th>
                        <th style="padding: 8px; text-align: left;">Actions</th>
                    </tr>
                </thead>
                <tbody>`;

        // Add each client row with alternating row colors
        clients.forEach((client, index) => {
            const rowColor = index % 2 === 0 ? '#f2f2f2' : '#ffffff'; // Alternate row colors
            const clientDir = path.join(adoptedClientsDir, client.group, client.client);
            const alias = client.alias;

            // Check the 'phonehome' file status
            const phonehomeFile = path.join(clientDir, 'phonehome');
            let statusDot = '<span style="color: lightgrey; font-size: 2em;">●</span>'; // Default to lightgrey dot
            let lastSeen = 'Never'; // Default if no phone home

            if (fs.existsSync(phonehomeFile)) {
                const lastModifiedTime = fs.statSync(phonehomeFile).mtime;
                const timeDifference = (new Date() - lastModifiedTime) / (1000 * 60); // Difference in minutes

                // Determine dot color based on time difference
                if (timeDifference <= 5) {
                    statusDot = '<span style="color: green; font-size: 2em;">●</span>'; // Green dot for recent phone home
                }

                // Format the last seen time as a readable string
                lastSeen = lastModifiedTime.toLocaleString(); // Convert to readable format
            }

            // HTML for each client row
            clientTableHtml += `
                <tr style="background-color: ${rowColor};">
                    <td style="padding: 8px;">${client.client}</td>
                    <td style="padding: 8px; text-align: center;">${statusDot}</td>
                    <td style="padding: 8px;">${lastSeen}</td>
                    <td style="padding: 8px;">${client.group}</td>
                    <td style="padding: 8px;" id="alias-${client.client}">
                        <span id="alias-text-${client.client}">${alias || 'No Alias'}</span>
                        <input type="text" id="alias-input-${client.client}" value="${alias}" style="display:none; width: 120px;">
                    </td>
                    <td style="padding: 8px;">
                        <button onclick="editAlias('${client.client}')" style="border: none; background: none; cursor: pointer;">
                            <span style="font-size: 16px; color: #007bff;">✏️</span>
                        </button>
                        <button id="save-${client.client}" onclick="saveAlias('${client.client}', '${client.group}')" style="display:none;">Save</button>
                        <button id="cancel-${client.client}" onclick="cancelEdit('${client.client}')" style="display:none;">Cancel</button>
                        <button onclick="confirmAndReboot('${client.client}', '${client.group}')" style="border: none; background: #007bff; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Reboot</button>
                    </td>
                </tr>`;
        });

        clientTableHtml += `
                </tbody>
            </table>
            <script>
                function editAlias(clientId) {
                    document.getElementById('alias-text-' + clientId).style.display = 'none';
                    document.getElementById('alias-input-' + clientId).style.display = 'inline';
                    document.getElementById('save-' + clientId).style.display = 'inline';
                    document.getElementById('cancel-' + clientId).style.display = 'inline';
                }

                function cancelEdit(clientId) {
                    document.getElementById('alias-text-' + clientId).style.display = 'inline';
                    document.getElementById('alias-input-' + clientId).style.display = 'none';
                    document.getElementById('save-' + clientId).style.display = 'none';
                    document.getElementById('cancel-' + clientId).style.display = 'none';
                }

                function saveAlias(clientId, groupName) {
                    const newAlias = document.getElementById('alias-input-' + clientId).value;
                    fetch('/edit-alias', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ deviceId: clientId, groupName: groupName, alias: newAlias })
                    }).then(() => {
                        document.getElementById('alias-text-' + clientId).textContent = newAlias || 'No Alias';
                        cancelEdit(clientId);
                    }).catch(err => console.error(err));
                }
                function confirmAndReboot(clientId, groupName) {
                    if (confirm('Confirm you want to reboot ' + clientId + ' on next operator call?')) {
                        fetch('/reboot-device', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ deviceId: clientId, groupName: groupName })
                        }).then(response => response.text())
                          .then(text => alert(text))
                          .catch(err => console.error(err));
                    }
                }
            </script>
            ${footer}
        `;
        res.send(clientTableHtml);
    });

    logToFile(req, 'Accessed index page.');
});

// Endpoint to handle reboot a device
app.post('/reboot-device', checkAuth, (req, res) => {
    const { deviceId, groupName } = req.body;
    const clientDir = path.join(adoptedClientsDir, groupName, deviceId);
    const rebootFilePath = path.join(clientDir, 'reboot');

    fs.closeSync(fs.openSync(rebootFilePath, 'w')); // Touch the 'reboot' file
    logToFile(req, `Reboot requested for device ${deviceId} in group ${groupName}`);
    res.send(`Reboot sentry set for ${deviceId}.`);
});

// Endpoint to edit the alias of a device
app.post('/edit-alias', checkAuth, (req, res) => {
    const { groupName, deviceId, alias } = req.body;

    if (!groupName || !deviceId) {
        logToFile(req, 'Group name or device ID not provided for alias editing.');
        return res.status(400).send('Group name or device ID not provided.');
    }

    const clientDir = path.join(adoptedClientsDir, groupName, deviceId);
    const aliasFile = path.join(clientDir, 'alias.txt');

    // Save the alias to the alias.txt file
    fs.writeFileSync(aliasFile, alias, 'utf-8');
    logToFile(req, `Alias for device ${deviceId} in group ${groupName} updated to: ${alias}`);

    res.redirect('/'); // Redirect back to the main page after saving the alias
});

// Endpoint to get the sctip to edit
app.get('/get-script', checkAuth, (req, res) => {
    const groupName = req.query.group;

    if (!groupName) {
        return res.status(400).send('Group name not provided.');
    }

    const libraryScriptPath = path.join(adoptedClientsDir, groupName, 'library.script');

    if (fs.existsSync(libraryScriptPath)) {
        const content = fs.readFileSync(libraryScriptPath, 'utf-8');
        res.send(content);
    } else {
        res.send('');
    }
});

// Serve the groups management page
app.get('/groups', checkAuth, (req, res) => {
    fs.readdir(adoptedClientsDir, (err, groups) => {
        if (err) {
            logToFile(req, 'Error reading groups directory.');
            return res.status(500).send('Error reading groups directory.');
        }

        includeHeaderAndFooter((header, footer) => {
            // Start building the HTML with a container for the card layout
            let groupListHtml = `
                ${header}
                <h1>Manage Groups</h1>
                <div style="display: flex; flex-wrap: wrap; gap: 20px; margin-top: 20px;">`;

            groups.forEach(group => {
                const groupPath = path.join(adoptedClientsDir, group);
                if (fs.lstatSync(groupPath).isDirectory()) {
                    // Read only directories within the groupPath
                    const clients = fs.readdirSync(groupPath).filter(client => 
                        fs.lstatSync(path.join(groupPath, client)).isDirectory()
                    );
                    const clientCount = clients.length;

                    // Read the library.script content
                    const libraryScriptPath = path.join(groupPath, 'library.script');
                    let libraryScriptContent = fs.existsSync(libraryScriptPath) ? fs.readFileSync(libraryScriptPath, 'utf-8') : 'No Script Available';

                    // Determine button state
                    const isDisabled = clientCount > 0 ? 'disabled' : '';
                    const buttonStyle = clientCount > 0 ? 'background-color: #ddd; color: #888; cursor: not-allowed;' : 'background-color: #ff4d4d; color: white; cursor: pointer;';
                    // Add a card for each group
                    groupListHtml += `
                        <div style="border: 1px solid #ddd; border-radius: 8px; padding: 16px; width: 300px; background-color: #f9f9f9; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);">
                            <h2 style="margin-top: 0;">${group}</h2>
                            <p><strong>Client Count:</strong> ${clientCount}</p>
                            <p><strong>Preview:</strong></p>
                            <div style="white-space: pre-wrap; font-family: monospace; background-color: #f8f8f8; border: 1px solid #ccc; padding: 8px; margin-top: 5px; max-height: 100px; overflow-y: auto;">
                                <pre>${libraryScriptContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                            </div>
                            <button onclick="openEditor('${group}')" style="border: none; background: none; cursor: pointer;">
                                <span style="font-size: 16px; color: #007bff;">✏️ Edit Script</span>
                            </button>
                            <form action="/delete-group" method="post" style="display:inline;" onsubmit="return confirm('Are you sure you want to delete this group?');">
                                <input type="hidden" name="groupName" value="${group}">
                                <button type="submit" ${isDisabled} style="${buttonStyle} border: none; border-radius: 4px; padding: 5px 10px;">Delete</button>
                            </form>
                        </div>`;
                }
            });

            groupListHtml += `
                </div>
                <h2 style="margin-top: 20px;">Add a New Group</h2>
                <form action="/add-group" method="post" style="margin-top: 10px;">
                    <input type="text" name="groupName" placeholder="Enter Group Name" required style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    <button type="submit" style="background-color: #28a745; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">Add Group</button>
                </form>
                <!-- Modal for Editing Library Script -->
                <div id="editModal" style="display:none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); justify-content: center; align-items: center;">
                    <div style="background-color: white; border-radius: 8px; padding: 20px; width: 90%; position: relative;">
                        <h3>Edit Library Script</h3>
                        <textarea id="modalScriptContent" style="width: 100%; height: 300px; font-family: monospace;"></textarea>
                        <div style="margin-top: 10px; text-align: right;">
                            <button onclick="saveScript()" style="margin-right: 5px;">Save</button>
                            <button onclick="closeModal()">Cancel</button>
                        </div>
                    </div>
                </div>
                <script>
                    let currentGroup = '';

                    function openEditor(group) {
                        currentGroup = group;
                        fetch('/get-script?group=' + encodeURIComponent(group))
                            .then(response => response.text())
                            .then(scriptContent => {
                                document.getElementById('modalScriptContent').value = scriptContent;
                                document.getElementById('editModal').style.display = 'flex';
                            })
                            .catch(err => alert('Failed to load script: ' + err.message));
                    }

                    function closeModal() {
                        document.getElementById('editModal').style.display = 'none';
                    }

                    function saveScript() {
                        const scriptContent = document.getElementById('modalScriptContent').value;
                        fetch('/edit-script', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ groupName: currentGroup, libraryScript: scriptContent })
                        }).then(() => {
                            closeModal(); // Close the modal after saving
                            alert('Script saved successfully.');
                            location.reload(); // Reload the page to show updated content
                        }).catch(err => alert('Failed to save script: ' + err.message));
                    }
                </script>
                ${footer}`;

            res.send(groupListHtml);
        });
        logToFile(req, 'Viewed groups management page.');
    });
});

// Endpoint to add a new group
app.post('/add-group', checkAuth, (req, res) => {
    const groupName = req.body.groupName ? req.body.groupName.trim() : null;

    if (!groupName) {
        logToFile(req, 'Group name not provided for addition.');
        return res.status(400).send('Group name not provided.');
    }

    const groupDir = path.join(adoptedClientsDir, groupName);

    if (!fs.existsSync(groupDir)) {
        fs.mkdirSync(groupDir);
        logToFile(req, `Group ${groupName} added.`);
        res.send(`Group ${groupName} has been added.
                <br><p>You will be redirected to the manage groups page in 3 seconds...</p>
                <script>
                    setTimeout(function() {
                        window.location.href = '/groups';
                    }, 3000);
                </script>`);
    } else {
        logToFile(req, `Group ${groupName} already exists.`);
        res.status(400).send('Group already exists.');
    }
});

// Endpoint to delete a group
app.post('/delete-group', checkAuth, (req, res) => {
    const groupName = req.body.groupName ? req.body.groupName.trim() : null;

    if (!groupName) {
        logToFile(req, 'Group name not provided for deletion.');
        return res.status(400).send('Group name not provided.');
    }

    const groupDir = path.join(adoptedClientsDir, groupName);

    if (fs.existsSync(groupDir)) {
        // Filter to ensure we only count directories
        const clients = fs.readdirSync(groupDir).filter(item =>
            fs.lstatSync(path.join(groupDir, item)).isDirectory()
        );

        if (clients.length === 0) {
            try {
                fs.rmdirSync(groupDir, { recursive: true }); // Safely try to remove the directory recursively
                logToFile(req, `Group ${groupName} deleted.`);
                res.send(`Group ${groupName} has been deleted.
                    <br><p>You will be redirected to the manage groups page in 3 seconds...</p>
                    <script>
                        setTimeout(function() {
                            window.location.href = '/groups';
                        }, 3000);
                    </script>`);
            } catch (err) {
                logToFile(req, `Error deleting non-empty group ${groupName}: ${err.message}`);
                res.status(500).send('Failed to delete group. Please ensure the group is empty before deleting.');
            }
        } else {
            logToFile(req, `Attempt to delete non-empty group ${groupName}.`);
            res.status(400).send('Group is not empty and cannot be deleted.');
        }
    } else {
        logToFile(req, `Group ${groupName} not found for deletion.`);
        res.status(404).send('Group not found.');
    }
});

// Endpoint to edit the library script of a group
app.post('/edit-script', checkAuth, (req, res) => {
    const { groupName, libraryScript } = req.body;

    if (!groupName) {
        logToFile(req, 'Group name not provided for script editing.');
        return res.status(400).send('Group name not provided.');
    }

    const groupDir = path.join(adoptedClientsDir, groupName);
    const libraryScriptPath = path.join(groupDir, 'library.script');

    // Save the script to 'library.script' file
    fs.writeFileSync(libraryScriptPath, libraryScript, 'utf-8');
    logToFile(req, `Library script for group ${groupName} updated.`);

    res.redirect('/groups'); // Redirect back to the Manage Groups page
});

// Serve the logs page
app.get('/logs', checkAuth, (req, res) => {
    // Read the contents of the server.log file
    fs.readFile(logFilePath, 'utf8', (err, logData) => {
        if (err) {
            logToFile(req, 'Error reading log file.');
            return res.status(500).send('Error reading log file.');
        }

        // Include header and footer with the log data
        includeHeaderAndFooter((header, footer) => {
            res.send(`
                ${header}
                <h1>Server Logs</h1>
                <pre style="white-space: pre-wrap; background-color: #f8f8f8; border: 1px solid #ddd; padding: 10px; max-height: 600px; overflow-y: auto;">
                    ${logData}
                </pre>
                ${footer}
            `);
        });
    });
    logToFile(req, 'Viewed logs.');
});

// Handle incoming requests for client identification
app.get('/operator', (req, res) => {
    const deviceSerial = req.query.deviceSerial ? req.query.deviceSerial.toUpperCase() : null;

    if (!deviceSerial) {
        logToFile(req, 'CPU serial number not provided.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, deviceSerial);
    let isAdopted = false;

    // Search for the client in all group directories under adopted_clients
    const groupDirectories = fs.readdirSync(adoptedClientsDir).filter(group =>
        fs.lstatSync(path.join(adoptedClientsDir, group)).isDirectory()
    );

    for (const group of groupDirectories) {
        const adoptedClientDir = path.join(adoptedClientsDir, group, deviceSerial);

        if (fs.existsSync(adoptedClientDir)) {
            // Client is found in one of the group directories
            isAdopted = true;

            // Create or update the 'phonehome' file to mark the client's check-in time
            const phonehomeFile = path.join(adoptedClientDir, 'phonehome');
            fs.writeFileSync(phonehomeFile, 'Client checked in');

            // Check for the reboot request in the client's directory
            const rebootFilePath = path.join(adoptedClientDir, 'reboot');
            if (fs.existsSync(rebootFilePath)) {
                fs.unlinkSync(rebootFilePath); // Remove the reboot file
                res.send('REBOOT'); // Send back the reboot command
                return;
            }

            // Check for the 'library.script' in the group directory
            const libraryScriptPath = path.join(adoptedClientsDir, group, 'library.script');
            let libraryScriptContent = '';

            if (fs.existsSync(libraryScriptPath)) {
                libraryScriptContent = fs.readFileSync(libraryScriptPath, 'utf-8');
            }

            logToFile(req, `Operator says, known machine: ${deviceSerial} in group ${group}. 'phonehome' file updated.`);
            res.send(libraryScriptContent); // Return the library script content
            return; // Exit the function once the client is found
        }
    }

    // If the client was not found in any group directory, check if it's pending adoption
    if (fs.existsSync(unknownClientFile)) {
        // Touch or update the file in pending adoption to mark the last contact time
        fs.writeFileSync(unknownClientFile, 'Client checked in');

        logToFile(req, `Operator says, pending machine check: ${deviceSerial}. 'unknownClientFile' updated.`);
        res.send('Machine is pending adoption.');
    } else {
        // Create a file in unknown_clients to mark it as a new, unadopted machine
        fs.writeFileSync(unknownClientFile, 'New client detected');
        logToFile(req, `Operator says, new client detected: ${deviceSerial}. File created.`);
        res.send('New device detected. Please follow the instructions to register.');
    }
});

// Serve the pending adoption page
app.get('/pending-adoption', checkAuth, (req, res) => {
    fs.readdir(unknownClientsDir, (err, files) => {
        if (err) {
            logToFile(req, 'Error reading unknown clients directory.');
            return res.status(500).send('Error reading unknown clients directory.');
        }

        // Read existing groups
        fs.readdir(adoptedClientsDir, (err, groups) => {
            if (err) {
                logToFile(req, 'Error reading groups directory.');
                return res.status(500).send('Error reading groups directory.');
            }

            // Generate the dropdown options for groups
            let groupOptions = groups
                .filter(group => fs.lstatSync(path.join(adoptedClientsDir, group)).isDirectory())
                .map(group => `<option value="${group}">${group}</option>`)
                .join('');

            includeHeaderAndFooter((header, footer) => {
                let clientListHtml = `
                    ${header}
                    <h1>Clients Pending Adoption</h1>
                    <ul class="client-list">`;

                files.forEach(file => {
                    clientListHtml += `<li>${file} - 
                                       <form action="/adopt" method="post" style="display:inline;">
                                           <input type="hidden" name="deviceSerial" value="${file}">
                                           <select name="groupName" required>
                                               <option value="" disabled selected>Select Group</option>
                                               ${groupOptions}
                                           </select>
                                           <button type="submit">Adopt</button>
                                       </form>
                                       <form action="/delete-pending" method="post" style="display:inline;" onsubmit="return confirm('Are you sure you want to delete this pending adoption?');">
                                           <input type="hidden" name="deviceSerial" value="${file}">
                                           <button type="submit">Delete</button>
                                       </form>
                                       </li>`;
                });

                clientListHtml += `</ul>${footer}`;
                res.send(clientListHtml);
            });

            logToFile(req, 'Viewed pending adoption clients with group selection.');
        });
    });
});

// Endpoint to adopt a machine from the web UI
app.post('/adopt', checkAuth, (req, res) => {
    const deviceSerial = req.body.deviceSerial ? req.body.deviceSerial.toUpperCase() : null;
    const groupName = req.body.groupName ? req.body.groupName.trim() : null;

    if (!deviceSerial || !groupName) {
        logToFile(req, 'CPU serial number or group name not provided for adoption.');
        return res.status(400).send('CPU serial number or group name not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, deviceSerial);
    const groupDir = path.join(adoptedClientsDir, groupName);
    const adoptedClientDir = path.join(groupDir, deviceSerial);

    // Ensure the group directory exists
    if (!fs.existsSync(groupDir)) {
        fs.mkdirSync(groupDir);
    }

    if (fs.existsSync(unknownClientFile)) {
        // Create a directory for the adopted client under the specified group
        fs.mkdirSync(adoptedClientDir);
        // Move the serial number file to the adopted clients directory
        fs.renameSync(unknownClientFile, path.join(adoptedClientDir, 'serial_number.txt'));
        logToFile(req, `Client ${deviceSerial} adopted to group ${groupName}.`);
        res.send(`Client ${deviceSerial} has been adopted to group ${groupName}.
                <br><p>You will be redirected to the pending adoption page in 3 seconds...</p>
                <script>
                    setTimeout(function() {
                        window.location.href = '/pending-adoption';
                    }, 3000);
                </script>`);
    } else {
        logToFile(req, `Client ${deviceSerial} not found in pending adoption list.`);
        res.status(404).send('Client not found in unknown clients.');
    }
});

// Endpoint to delete a pending adoption entry
app.post('/delete-pending', checkAuth, (req, res) => {
    const deviceSerial = req.body.deviceSerial ? req.body.deviceSerial.toUpperCase() : null;

    if (!deviceSerial) {
        logToFile(req, 'CPU serial number not provided for deletion.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, deviceSerial);

    if (fs.existsSync(unknownClientFile)) {
        fs.unlinkSync(unknownClientFile);
        logToFile(req, `Pending adoption entry for ${deviceSerial} deleted.`);
        res.send(`Pending adoption entry for ${deviceSerial} has been deleted.<br><a href="/pending-adoption">Back to Pending Adoption</a>`);
    } else {
        logToFile(req, `Client ${deviceSerial} not found in pending adoption list for deletion.`);
        res.status(404).send('Client not found in pending adoption list.');
    }
});

// Serve the page to view adopted clients
app.get('/view-adopted', checkAuth, (req, res) => {
    fs.readdir(adoptedClientsDir, (err, groups) => {
        if (err) {
            logToFile(req, 'Error reading adopted clients directory.');
            return res.status(500).send('Error reading adopted clients directory.');
        }
        includeHeaderAndFooter((header, footer) => {
            let clientListHtml = `${header}
                <h1>Adopted Clients by Group</h1>
                <form id="batchForm" method="post" action="/batch-operation">
                    <div style="margin-bottom: 10px;">
                        <button type="button" onclick="deleteSelected()" style="background-color: #ff4d4d; color: white; border: none; padding: 5px 10px; border-radius: 4px;">Delete Selected</button>
                        <button type="button" onclick="moveSelected()" style="background-color: #007bff; color: white; border: none; padding: 5px 10px; border-radius: 4px;">Move Selected to Another Group</button>
                    </div>
                    <ul class="client-list">`;

            groups.forEach(group => {
                const groupPath = path.join(adoptedClientsDir, group);
                if (fs.lstatSync(groupPath).isDirectory()) {
                    clientListHtml += `<li><strong>Group: ${group}</strong><ul>`;

                    // List all clients within the group directory
                    const clients = fs.readdirSync(groupPath);
                    clients.forEach(client => {
                        const clientPath = path.join(groupPath, client);
                        if (fs.lstatSync(clientPath).isDirectory()) {
                            const aliasFile = path.join(clientPath, 'alias.txt');
                            let alias = fs.existsSync(aliasFile) ? fs.readFileSync(aliasFile, 'utf-8').trim() : 'No Alias';

                            clientListHtml += `<li>
                                <input type="checkbox" name="clients" value="${group}|${client}"> ${client} (${alias})
                                </li>`;
                        }
                    });

                    clientListHtml += `</ul></li>`;
                }
            });

            clientListHtml += `</ul>
                <input type="hidden" name="operation" id="operationInput" value="">
                <br><a href="/">Back to Home</a>
                </form>
                <script>
                    function deleteSelected() {
                        if (confirm('Are you sure you want to delete the selected clients?')) {
                            document.getElementById('operationInput').value = 'delete';
                            document.getElementById('batchForm').submit();
                        }
                    }

                    function moveSelected() {
                        const newGroup = prompt('Enter the new group name:');
                        if (newGroup) {
                            document.getElementById('operationInput').value = 'move|' + newGroup;
                            document.getElementById('batchForm').submit();
                        }
                    }
                </script>
                ${footer}`;
            res.send(clientListHtml);
        });
        logToFile(req, 'Viewed adopted clients.');
    });
});

// Handle batch operations for clients
app.post('/batch-operation', checkAuth, (req, res) => {
    const { clients, operation } = req.body;

    if (!clients) {
        logToFile(req, 'No clients selected for batch operation.');
        return res.redirect('/view-adopted');
    }

    const clientsArray = Array.isArray(clients) ? clients : [clients];
    const [action, newGroup] = operation.split('|');

    clientsArray.forEach(clientInfo => {
        const [groupName, client] = clientInfo.split('|');
        const clientPath = path.join(adoptedClientsDir, groupName, client);

        if (action === 'delete') {
            // Delete the client directory
            fs.rmdirSync(clientPath, { recursive: true });
            logToFile(req, `Deleted client ${client} from group ${groupName}.`);
        } else if (action === 'move' && newGroup) {
            // Move the client to the new group
            const newGroupPath = path.join(adoptedClientsDir, newGroup);
            if (!fs.existsSync(newGroupPath)) {
                fs.mkdirSync(newGroupPath);
            }
            const newClientPath = path.join(newGroupPath, client);
            fs.renameSync(clientPath, newClientPath);
            logToFile(req, `Moved client ${client} from group ${groupName} to group ${newGroup}.`);
        }
    });

    res.redirect('/view-adopted'); // Redirect back to the view page after operation
});


// Endpoint to delete an adopted client entry
app.post('/delete-adopted', checkAuth, (req, res) => {
    const deviceSerial = req.body.deviceSerial ? req.body.deviceSerial.toUpperCase() : null;
    const groupName = req.body.groupName ? req.body.groupName.trim() : null;

    if (!deviceSerial || !groupName) {
        logToFile(req, 'CPU serial number or group name not provided for deletion.');
        return res.status(400).send('CPU serial number or group name not provided.');
    }

    const adoptedClientDir = path.join(adoptedClientsDir, groupName, deviceSerial);

    if (fs.existsSync(adoptedClientDir)) {
        fs.rmSync(adoptedClientDir, { recursive: true });
        logToFile(req, `Adopted entry for ${deviceSerial} in group ${groupName} deleted.`);
        res.send(`Adopted entry for ${deviceSerial} in group ${groupName} has been deleted.
                <br><p>You will be redirected to the adopted clients page in 3 seconds...</p>
                <script>
                    setTimeout(function() {
                        window.location.href = '/view-adopted';
                    }, 3000);
                </script>`);
    } else {
        logToFile(req, `Client ${deviceSerial} in group ${groupName} not found for deletion.`);
        res.status(404).send('Client not found in adopted clients list.');
    }
});

// Start the HTTPS server
httpsServer.listen(port, () => {
    logToFile(null, `Device management server running securely on https://localhost:${port}`);
    console.log(`Device management server running securely on https://localhost:${port}`);
});
