# dosi
Device Operating System Injection

## Notes
\# Add a cert with something like the following
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -passout pass: -subj "/C=US/ST=State/L=Locality/O=Organization/CN=localhost"

\# server listens on 8443
