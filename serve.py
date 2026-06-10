# 本地预览服务器：python3 serve.py 后访问 http://localhost:8765
import http.server
import socketserver

PORT = 8765

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript; charset=utf-8",
                      ".html": "text/html; charset=utf-8",
                      ".css": "text/css; charset=utf-8",
                      ".csv": "text/csv; charset=utf-8"}

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    httpd.serve_forever()
