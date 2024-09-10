const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 3000;

// Log file path
const logFilePath = path.join(__dirname, 'server.log');

// Function to log messages to the file
// Function to log messages to the file
function logToFile(req, message) {
    let ip = 'N/A';
    if (req) {
        ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    }
    const logMessage = `[${new Date().toISOString()}] [IP: ${ip}] ${message}\n`;
    fs.appendFileSync(logFilePath, logMessage, 'utf8');
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

// Serve the index page, protected by authentication
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
    logToFile(req, 'Accessed index page.');
});

// Login route
app.get('/login', (req, res) => {
    res.send(`
        <html>
        <body>
            <h1>Login</h1>
            <form action="/login" method="post">
                <label for="username">Username:</label><br>
                <input type="text" id="username" name="username"><br><br>
                <label for="password">Password:</label><br>
                <input type="password" id="password" name="password"><br><br>
                <input type="submit" value="Login">
            </form>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Check credentials against those in credentials.json
    if (username === credentials.username && password === credentials.password) {
        req.session.isAuthenticated = true;
        logToFile(req, `Successful login by user: ${username}`);
        res.redirect('/'); // Redirect to the home page after login
    } else {
        logToFile(req, `Failed login attempt with username: ${username}`);
        res.status(401).send('Invalid credentials.');
    }
});

// Logout route
app.get('/logout', (req, res) => {
    logToFile(req, 'User logged out.');
    req.session.destroy();
    res.send('Logged out successfully! <a href="/login">Login Again</a>');
});

// Protect all routes except /operator
app.use((req, res, next) => {
    if (req.path === '/operator') {
        next(); // Allow access to /operator without authentication
    } else {
        checkAuth(req, res, next); // Require authentication for all other routes
    }
});

// Handle incoming requests for client identification
app.get('/operator', (req, res) => {
    const cpuSerial = req.query.cpuSerial ? req.query.cpuSerial.toUpperCase() : null;

    if (!cpuSerial) {
        logToFile(req, 'CPU serial number not provided.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const adoptedClientDir = path.join(adoptedClientsDir, cpuSerial);
    const unknownClientFile = path.join(unknownClientsDir, cpuSerial);

    if (fs.existsSync(adoptedClientDir)) {
        logToFile(req, `Operator says, known machine: ${cpuSerial}`);
        res.send('Machine is already known and adopted.');
    } else if (fs.existsSync(unknownClientFile)) {
        logToFile(req, `Operator says, pending machine: ${cpuSerial}`);
        res.send('Machine is pending adoption.');
    } else {
        // Create a file in unknown_clients to mark it as a new, unadopted machine
        fs.writeFileSync(unknownClientFile, 'New client detected');
        logToFile(req, `Operator says, new client detected: ${cpuSerial}. File created.`);
        res.send('New device detected. Please follow the instructions to register.');
    }
});

// Serve the pending adoption page
app.get('/pending-adoption', (req, res) => {
    // List all unknown clients for adoption
    fs.readdir(unknownClientsDir, (err, files) => {
        if (err) {
            logToFile(req, 'Error reading unknown clients directory.');
            return res.status(500).send('Error reading unknown clients directory.');
        }
        let clientListHtml = `
        <html>
        <head>
            <style>
                ul.client-list li:nth-child(odd) {
                    background-color: #f0f0f0; /* Light gray for odd rows */
                }
                ul.client-list li:nth-child(even) {
                    background-color: #ffffff; /* White for even rows */
                }
            </style>
        </head>
        <body>
            <h1>Clients Pending Adoption</h1>
            <ul class="client-list">`;
        files.forEach(file => {
            clientListHtml += `<li>${file} - 
                               <form action="/adopt" method="post" style="display:inline;">
                                   <input type="hidden" name="cpuSerial" value="${file}">
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
        </body>
        </html>`;
        res.send(clientListHtml);
        logToFile(req, 'Viewed pending adoption clients.');
    });
});

// Endpoint to adopt a machine from the web UI
app.post('/adopt', (req, res) => {
    const cpuSerial = req.body.cpuSerial ? req.body.cpuSerial.toUpperCase() : null;

    if (!cpuSerial) {
        logToFile(req, 'CPU serial number not provided for adoption.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const unknownClientFile = path.join(unknownClientsDir, cpuSerial);
    const adoptedClientDir = path.join(adoptedClientsDir, cpuSerial);

    if (fs.existsSync(unknownClientFile)) {
        // Create a directory for the adopted client named after its CPU serial number
        fs.mkdirSync(adoptedClientDir);
        // Move the serial number file to the adopted clients directory
        fs.renameSync(unknownClientFile, path.join(adoptedClientDir, 'serial_number.txt'));
        logToFile(req, `Client ${cpuSerial} adopted.`);
        res.send(`Client ${cpuSerial} has been adopted.<br><a href="/view-adopted">View Adopted Clients</a>`);
    } else {
        logToFile(req, `Client ${cpuSerial} not found in pending adoption list.`);
        res.status(404).send('Client not found in unknown clients.');
    }
});

// Endpoint to delete a pending adoption entry
app.post('/delete-pending', (req, res) => {
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
app.get('/view-adopted', (req, res) => {
    // List all adopted clients
    fs.readdir(adoptedClientsDir, (err, files) => {
        if (err) {
            logToFile(req, 'Error reading adopted clients directory.');
            return res.status(500).send('Error reading adopted clients directory.');
        }
        let clientListHtml = `
        <html>
        <head>
            <style>
                ul.client-list li:nth-child(odd) {
                    background-color: #f0f0f0; /* Light gray for odd rows */
                }
                ul.client-list li:nth-child(even) {
                    background-color: #ffffff; /* White for even rows */
                }
            </style>
        </head>
        <body>
            <h1>Adopted Clients</h1>
            <ul class="client-list">`;
        files.forEach(file => {
            clientListHtml += `<li>${file} - 
                               <form action="/delete-adopted" method="post" style="display:inline;" onsubmit="return confirm('Are you sure you want to delete this adopted client?');">
                                   <input type="hidden" name="cpuSerial" value="${file}">
                                   <button type="submit">Delete</button>
                               </form>
                               </li>`;
        });
        clientListHtml += `
            </ul>
            <br><a href="/pending-adoption">Pending Adoption Clients</a>
        </body>
        </html>`;
        res.send(clientListHtml);
        logToFile(req, 'Viewed adopted clients.');
    });
});

// Endpoint to delete an adopted client entry
app.post('/delete-adopted', (req, res) => {
    const cpuSerial = req.body.cpuSerial ? req.body.cpuSerial.toUpperCase() : null;

    if (!cpuSerial) {
        logToFile(req, 'CPU serial number not provided for deletion.');
        return res.status(400).send('CPU serial number not provided.');
    }

    const adoptedClientDir = path.join(adoptedClientsDir, cpuSerial);

    if (fs.existsSync(adoptedClientDir)) {
        fs.rmSync(adoptedClientDir, { recursive: true });
        logToFile(req, `Adopted entry for ${cpuSerial} deleted.`);
        res.send(`Adopted entry for ${cpuSerial} has been deleted.<br><a href="/view-adopted">Back to Adopted Clients</a>`);
    } else {
        logToFile(req, `Client ${cpuSerial} not found in adopted clients list for deletion.`);
        res.status(404).send('Client not found in adopted clients list.');
    }
});

app.listen(port, () => {
    logToFile(null, `Device management server running on http://localhost:${port}`);
    console.log(`Device management server running on http://localhost:${port}`);
});

