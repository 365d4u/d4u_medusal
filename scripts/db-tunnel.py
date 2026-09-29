"""Local development tunnel; password supplied only through environment."""
import os
import select
import socketserver
import paramiko

client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(os.environ['DEPLOY_SSH_HOST'], port=int(os.environ.get('DEPLOY_SSH_PORT','22')), username='root', password=os.environ['DEPLOY_SSH_PASSWORD'], timeout=20)
transport = client.get_transport()
transport.set_keepalive(30)

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        channel = transport.open_channel('direct-tcpip', ('127.0.0.1', 5432), self.request.getpeername())
        try:
            while True:
                ready, _, _ = select.select([self.request, channel], [], [], 30)
                for source in ready:
                    data = source.recv(65536)
                    if not data: return
                    (channel if source is self.request else self.request).sendall(data)
        finally:
            channel.close()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

with Server(('127.0.0.1', 15432), Handler) as server:
    print('PostgreSQL tunnel ready on 127.0.0.1:15432', flush=True)
    server.serve_forever()
