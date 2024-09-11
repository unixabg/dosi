const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 3000;

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
    includeHeaderAndFooter((header, footer) => {
        res.send(`
            ${header}
            <h1>Login</h1>
            <form action="/login" method="post">
                <label for="username">Username:</label><br>
                <input type="text" id="username" name="username" required><br><br>
                <label for="password">Password:</label><br>
                <input type="password" id="password" name="password" required><br><br>
                <input type="submit" value="Login">
            </form>
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
            ${header}
            <h1>Logged out successfully!</h1>
            <a href="/login">Login Again</a>
            ${footer}
        `);
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

    includeHeaderAndFooter((header, footer) => {
        // Build the client table HTML with alternating row colors
        let clientTableHtml = `
            ${header}
            <h1>Welcome to the Device Operating System Injection (DOSI) Management Dashboard</h1>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #333; color: white;">
                        <th style="padding: 8px; text-align: left;">Device ID</th>
                        <th style="padding: 8px; text-align: left;">Status</th>
                        <th style="padding: 8px; text-align: left;">Last Seen</th>
                        <th style="padding: 8px; text-align: left;">Group</th>
                    </tr>
                </thead>
                <tbody>`;

        // Add each client row with alternating row colors
        clients.forEach((client, index) => {
            const rowColor = index % 2 === 0 ? '#f2f2f2' : '#ffffff'; // Alternate row colors

            // Check the 'phonehome' file status
            const phonehomeFile = path.join(adoptedClientsDir, client.group, client.client, 'phonehome');
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

            clientTableHtml += `
                <tr style="background-color: ${rowColor};">
                    <td style="padding: 8px;">${client.client}</td>
                    <td style="padding: 8px; text-align: center;">${statusDot}</td>
                    <td style="padding: 8px;">${lastSeen}</td>
                    <td style="padding: 8px;">${client.group}</td>
                </tr>`;
        });

        clientTableHtml += `
                </tbody>
            </table>
            ${footer}
        `;
        res.send(clientTableHtml);
    });

    logToFile(req, 'Accessed index page.');
});

// Serve the groups management page
app.get('/groups', checkAuth, (req, res) => {
    fs.readdir(adoptedClientsDir, (err, groups) => {
        if (err) {
            logToFile(req, 'Error reading groups directory.');
            return res.status(500).send('Error reading groups directory.');
        }
        includeHeaderAndFooter((header, footer) => {
            let groupListHtml = `${header}<h1>Manage Groups</h1><ul class="group-list">`;
            groups.forEach(group => {
                const groupPath = path.join(adoptedClientsDir, group);
                if (fs.lstatSync(groupPath).isDirectory()) {
                    const clients = fs.readdirSync(groupPath);
                    const clientCount = clients.length;
                    groupListHtml += `<li>${group} - ${clientCount} clients 
                                      <form action="/delete-group" method="post" style="display:inline;" onsubmit="return confirm('Are you sure you want to delete this group?');">
                                          <input type="hidden" name="groupName" value="${group}">
                                          <button type="submit" ${clientCount > 0 ? 'disabled' : ''}>Delete</button>
                                      </form>
                                      </li>`;
                }
            });
            groupListHtml += `</ul>
                <h2>Add a New Group</h2>
                <form action="/add-group" method="post">
                    <input type="text" name="groupName" placeholder="Enter Group Name" required>
                    <button type="submit">Add Group</button>
                </form>
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
        res.send(`Group ${groupName} has been added.<br><a href="/groups">Back to Manage Groups</a>`);
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
        const clients = fs.readdirSync(groupDir);
        if (clients.length === 0) {
            fs.rmdirSync(groupDir);
            logToFile(req, `Group ${groupName} deleted.`);
            res.send(`Group ${groupName} has been deleted.<br><a href="/groups">Back to Manage Groups</a>`);
        } else {
            logToFile(req, `Attempt to delete non-empty group ${groupName}.`);
            res.status(400).send('Group is not empty and cannot be deleted.');
        }
    } else {
        logToFile(req, `Group ${groupName} not found for deletion.`);
        res.status(404).send('Group not found.');
    }
});

// Handle incoming requests for client identification
app.get('/operator', (req, res) => {
    const cpuSerial = req.query.cpuSerial ? req.query.cpuSerial.toUpperCase() : null;

    if (!cpuSerial) {
        logToFile(req, 'CPU serial number not provided.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, cpuSerial);
    let isAdopted = false;

    // Search for the client in all group directories under adopted_clients
    const groupDirectories = fs.readdirSync(adoptedClientsDir).filter(group =>
        fs.lstatSync(path.join(adoptedClientsDir, group)).isDirectory()
    );

    for (const group of groupDirectories) {
        const adoptedClientDir = path.join(adoptedClientsDir, group, cpuSerial);

        if (fs.existsSync(adoptedClientDir)) {
            // Client is found in one of the group directories
            isAdopted = true;

            // Create or update the 'phonehome' file to mark the client's check-in time
            const phonehomeFile = path.join(adoptedClientDir, 'phonehome');
            fs.writeFileSync(phonehomeFile, 'Client checked in');

            logToFile(req, `Operator says, known machine: ${cpuSerial} in group ${group}. 'phonehome' file updated.`);
            res.send('Machine is already known and adopted.');
            return; // Exit the function once the client is found
        }
    }

    // If the client was not found in any group directory, check if it's pending adoption
    if (fs.existsSync(unknownClientFile)) {
        // Touch or update the file in pending adoption to mark the last contact time
        fs.writeFileSync(unknownClientFile, 'Client checked in');

        logToFile(req, `Operator says, pending machine check: ${cpuSerial}. 'unknownClientFile' updated.`);
        res.send('Machine is pending adoption.');
    } else {
        // Create a file in unknown_clients to mark it as a new, unadopted machine
        fs.writeFileSync(unknownClientFile, 'New client detected');
        logToFile(req, `Operator says, new client detected: ${cpuSerial}. File created.`);
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
                                           <input type="hidden" name="cpuSerial" value="${file}">
                                           <select name="groupName" required>
                                               <option value="" disabled selected>Select Group</option>
                                               ${groupOptions}
                                           </select>
                                           <button type="submit">Adopt</button>
                                       </form>
                                       <form action="/delete-pending" method="post" style="display:inline;" onsubmit="return confirm('Are you sure you want to delete this pending adoption?');">
                                           <input type="hidden" name="cpuSerial" value="${file}">
                                           <button type="submit">Delete</button>
                                       </form>
                                       </li>`;
                });

                clientListHtml += `
                    </ul>
                    <br><a href="/view-adopted">View Adopted Clients</a>
                    ${footer}`;
                res.send(clientListHtml);
            });

            logToFile(req, 'Viewed pending adoption clients with group selection.');
        });
    });
});

// Endpoint to adopt a machine from the web UI
app.post('/adopt', checkAuth, (req, res) => {
    const cpuSerial = req.body.cpuSerial ? req.body.cpuSerial.toUpperCase() : null;
    const groupName = req.body.groupName ? req.body.groupName.trim() : null;

    if (!cpuSerial || !groupName) {
        logToFile(req, 'CPU serial number or group name not provided for adoption.');
        return res.status(400).send('CPU serial number or group name not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, cpuSerial);
    const groupDir = path.join(adoptedClientsDir, groupName);
    const adoptedClientDir = path.join(groupDir, cpuSerial);

    // Ensure the group directory exists
    if (!fs.existsSync(groupDir)) {
        fs.mkdirSync(groupDir);
    }

    if (fs.existsSync(unknownClientFile)) {
        // Create a directory for the adopted client under the specified group
        fs.mkdirSync(adoptedClientDir);
        // Move the serial number file to the adopted clients directory
        fs.renameSync(unknownClientFile, path.join(adoptedClientDir, 'serial_number.txt'));
        logToFile(req, `Client ${cpuSerial} adopted to group ${groupName}.`);
        res.send(`Client ${cpuSerial} has been adopted to group ${groupName}.<br><a href="/view-adopted">View Adopted Clients</a>`);
    } else {
        logToFile(req, `Client ${cpuSerial} not found in pending adoption list.`);
        res.status(404).send('Client not found in unknown clients.');
    }
});

// Endpoint to delete a pending adoption entry
app.post('/delete-pending', checkAuth, (req, res) => {
    const cpuSerial = req.body.cpuSerial ? req.body.cpuSerial.toUpperCase() : null;

    if (!cpuSerial) {
        logToFile(req, 'CPU serial number not provided for deletion.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, cpuSerial);

    if (fs.existsSync(unknownClientFile)) {
        fs.unlinkSync(unknownClientFile);
        logToFile(req, `Pending adoption entry for ${cpuSerial} deleted.`);
        res.send(`Pending adoption entry for ${cpuSerial} has been deleted.<br><a href="/pending-adoption">Back to Pending Adoption</a>`);
    } else {
        logToFile(req, `Client ${cpuSerial} not found in pending adoption list for deletion.`);
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
            let clientListHtml = `${header}<h1>Adopted Clients by Group</h1><ul class="client-list">`;
            groups.forEach(group => {
                const groupPath = path.join(adoptedClientsDir, group);
                if (fs.lstatSync(groupPath).isDirectory()) {
                    clientListHtml += `<li><strong>Group: ${group}</strong><ul>`;
                    const clients = fs.readdirSync(groupPath);
                    clients.forEach(client => {
                        clientListHtml += `<li>${client} - 
                                           <form action="/delete-adopted" method="post" style="display:inline;" onsubmit="return confirm('Are you sure you want to delete this adopted client?');">
                                               <input type="hidden" name="cpuSerial" value="${client}">
                                               <input type="hidden" name="groupName" value="${group}">
                                               <button type="submit">Delete</button>
                                           </form>
                                           </li>`;
                    });
                    clientListHtml += `</ul></li>`;
                }
            });
            clientListHtml += `</ul><br><a href="/pending-adoption">Pending Adoption Clients</a>${footer}`;
            res.send(clientListHtml);
        });
        logToFile(req, 'Viewed adopted clients.');
    });
});

// Endpoint to delete an adopted client entry
app.post('/delete-adopted', checkAuth, (req, res) => {
    const cpuSerial = req.body.cpuSerial ? req.body.cpuSerial.toUpperCase() : null;
    const groupName = req.body.groupName ? req.body.groupName.trim() : null;

    if (!cpuSerial || !groupName) {
        logToFile(req, 'CPU serial number or group name not provided for deletion.');
        return res.status(400).send('CPU serial number or group name not provided.');
    }

    const adoptedClientDir = path.join(adoptedClientsDir, groupName, cpuSerial);

    if (fs.existsSync(adoptedClientDir)) {
        fs.rmSync(adoptedClientDir, { recursive: true });
        logToFile(req, `Adopted entry for ${cpuSerial} in group ${groupName} deleted.`);
        res.send(`Adopted entry for ${cpuSerial} in group ${groupName} has been deleted.<br><a href="/view-adopted">Back to Adopted Clients</a>`);
    } else {
        logToFile(req, `Client ${cpuSerial} in group ${groupName} not found for deletion.`);
        res.status(404).send('Client not found in adopted clients list.');
    }
});

app.listen(port, () => {
    logToFile(null, `Device management server running on http://localhost:${port}`);
    console.log(`Device management server running on http://localhost:${port}`);
});

