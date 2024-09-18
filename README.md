# dosi - Device Operating System Injection
This project provides a web-based dashboard to manage devices, handle device adoptions, and execute various operations using a secure HTTPS server.

## Installation Instructions

Follow these steps to install and run the DOSI server on a Debian-based system:

### Prerequisites

- **Debian-based OS**: This guide assumes you are using a Debian-based Linux distribution (like Ubuntu).
## Dependencies
### System Dependencies
- **Node.js**: Version 12 or higher. Required to run the server.
- **NPM**: Comes with Node.js, required for managing Node.js packages.
- **OpenSSL**: Required for generating self-signed SSL certificates to enable HTTPS.
### Node.js Dependencies
The following Node.js packages are required to run the project:
- **express**: Web framework for building the server.
- **express-session**: Middleware for managing user sessions.
- **body-parser**: Middleware to handle incoming request bodies in Express.
### Some install notes
- **Nodejs**: Install nodejs:
  ```bash
  sudo apt update
  sudo apt install -y nodejs npm
  ```
- **Git**:If you haven't already installed Git, do so by running
  ```bash
  git clone https://github.com/unixabg/dosi.git
  ```
- **Dependencies**: From here install a few node dependencies:
  ```bash
  cd dosi
  npm install express body-parser express-session
  # Create self signed cert
  openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -passout pass: -subj "/C=US/ST=State/L=Locality/O=Organization/CN=localhost"
  ```
- **Credentials**: Set username and password:
  ```bash
  echo '{
    "username": "admin",
    "password": "password"
  }' > credentials.json
  ```
- **Launch dosi**: You should be ready to launch dosi. Check the server.log for information:
  ```bash
  node dosi.js >> server.log 2>&1 &`
  ```
- **Access the dashboard**: On the machine running dosi you should now be able to access the dashboard at https://localhost:8443

