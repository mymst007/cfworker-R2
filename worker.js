import { SignJWT, jwtVerify } from 'jose';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // 简单的 Cookie Session 验证
    const isLoggedIn = await verifySession(request, env);
    if (!isLoggedIn && pathname !== '/login' && pathname !== '/auth') {
      return redirectToLogin();
    }

    if (request.method === 'POST' && pathname === '/auth') {
      const form = await request.formData();
      const password = form.get('password');
      if (password === env.ADMIN_PASSWORD) {
        return await setSession(env);
      }
      return new Response('Unauthorized', { status: 401 });
    }

    if (pathname === '/logout') {
      // console.log('out1!');
      return clearSession();
    }

    if (pathname === '/') {
      return new Response(renderHTML(), { headers: { 'Content-Type': 'text/html' } });
    }

    // API 端点：上传、删除、文件夹操作
    if (pathname.startsWith('/api/')) {
      return handleApi(request, env);
    }

    // 其他所有get都为下载文件
    if (request.method === 'GET') {
      const trimSlashes = str => str.split('/').filter(v => v !== '').join('/');
      const key = trimSlashes(pathname);
      // console.log(key);
      const object = await env.MY_BUCKET.get(key);
      if (!object) return new Response("File not found", { status: 404 });

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${key.split('/').pop()}"`,
        }
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

function renderHTML() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>R2 文件管理器</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="p-4">
      <div class="container">
        <h1>Cloudflare R2 文件管理器</h1>
        <div>
          <button onclick="location.href = '/logout'" class="btn btn-secondary btn-sm mb-3">登出</button>
          <form id="upload-form">
            <input type="file" name="file" />
            <button type="submit" class="btn btn-primary btn-sm">上传文件</button>
          </form>
          <input type="text" id="new-folder" placeholder="新建文件夹名" />
          <button onclick="createFolder()" class="btn btn-success btn-sm">新建文件夹</button>
          <div id="file-list" class="mt-4"></div>
        </div>
      </div>
      <script>
        function formatDateTime(dateStr) {
          var date = new Date(dateStr);
          var y = date.getFullYear();
          var m = ('0' + (date.getMonth() + 1)).slice(-2);
          var d = ('0' + date.getDate()).slice(-2);
          var h = ('0' + date.getHours()).slice(-2);
          var min = ('0' + date.getMinutes()).slice(-2);
          var s = ('0' + date.getSeconds()).slice(-2);
          return y + '-' + m + '-' + d + ' ' + h + ':' + min + ':' + s;
        }

        // 文件大小格式化
        function getFileSizeDescription(bytes) {
          const units = ['Byte', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
          let i = 0;
          while (bytes >= 1024) {
              bytes /= 1024;
              i++;
          }
          return bytes.toFixed(2) + ' ' + units[i];
        }

        function getFileType(fileName) {
          const ext = fileName.split('.').pop().toLowerCase();
          const types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'asp': 'text/html',
            'html': 'text/html',
            'json': 'application/json',
            'zip': 'application/zip',
            'mp4': 'video/mp4',
            // 添加更多扩展名映射
          };
          
          return types[ext] || 'undefined';
        }

        async function logout() {
          await fetch('/logout');
          location.reload();
        }

        let currentPath = '';

        async function listFiles() {
          const res = await fetch('/api/list?path=' + encodeURIComponent(currentPath));
          const data = await res.json();
          const list = document.getElementById('file-list');
        
          let html = '<h5>当前路径: /' + currentPath + '</h5>';
          if (currentPath) {
            html += '<button class="btn btn-link btn-sm" onclick="goBack()">⬅️ 返回上层</button>';
          }
        
          html += '<div class="table-responsive mt-3">';
          html += '<table class="table table-striped table-bordered align-middle">';
          html += '<thead class="table-light"><tr>' +
            '<th>名称</th>' +
            '<th style="width: 200px;">大小</th>' +
            '<th style="width: 150px;">类型</th>' +
            '<th style="width: 230px;">修改时间</th>' +
            '<th style="width: 250px;">操作</th>' +
            '</tr></thead><tbody>';
        
          for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var encodedName = encodeURIComponent(item.name);
        
            if (item.name.endsWith('/')) {
              var folderName = item.name.replace(currentPath, '').replace('\/', '');
              var encodedFolder = encodeURIComponent(folderName);
        
              html += '<tr>' +
                '<td><a href="" data-folder="' + encodedFolder + '" onclick="enterFolderFromLink(this); return false;" style="text-decoration: none;">📁</a> <a href="" data-folder="' + encodedFolder + '" onclick="enterFolderFromLink(this); return false;">' + folderName + '</a></td>' +
                '<td>--</td>' +
                '<td>文件夹</td>' +
                '<td>--</td>' +
                '<td><button class="btn btn-danger btn-sm float-end" data-name="' + encodedName + '" onclick="deleteFromButton(this)">删除</button></td>' +
                '</tr>';
            } else {
              var fileName = item.name.replace(currentPath, '');
              // var sizeKB = (item.size / 1024).toFixed(1);
              var sizeKB = getFileSizeDescription(item.size);
              // var type = getFileType(item.name) || item.contentType;
              var type = item.httpMetadata?.contentType || getFileType(item.name);
              var modified = item.lastModified ? formatDateTime(item.lastModified) : '';
        
              html += '<tr>' +
                '<td>📄 ' + fileName + '</td>' +
                '<td>' + sizeKB + '</td>' +
                '<td>' + type + '</td>' +
                '<td>' + modified + '</td>' +
                '<td><div class="btn-group btn-group-sm float-end">' +
                '<button class="btn btn-secondary btn-sm float-end" data-name="' + encodeURIComponent(item.name) + '" onclick="copyObject(this)">Copy</button>' +
                '<a class="btn btn-info btn-sm" href="/api/download?name=' + encodedName + '" target="_blank">下载</a>' +
                // '<a class="btn btn-info btn-sm float-end" href="/api/download?name=' + encodeURIComponent(item.name) + '" target="_blank">下载</a>' +
                '<button class="btn btn-danger btn-sm" data-name="' + encodedName + '" onclick="deleteFromButton(this)">删除</button>' +
                // '<button class="btn btn-danger btn-sm float-end" data-name="' + encodeURIComponent(fileName) + '" onclick="deleteFromButton(this)">删除</button>' +
                '</div></td>' +
                '</tr>';
            }
          }
        
          html += '</tbody></table></div>';
          list.innerHTML = html;
        }
        

      function enterFolder(folder) {
        currentPath += folder + '/';
        listFiles();
      }
      function showToast(message) {
          const container = document.getElementById('toast-container');
          const id = 'toast-' + Date.now();

          const toast = document.createElement('div');
          toast.id = id;
          toast.className = 'toast align-items-center text-warning text-bg-secondary border-0 show';
          toast.role = 'alert';
          toast.ariaLive = 'assertive';
          toast.ariaAtomic = 'true';
          toast.style = 'min-width: 200px; margin-bottom: 10px;';
          toast.innerHTML = '<div class="d-flex"><div class="toast-body">' + message + '</div>' +
                            '<button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="removeToast(\\'' + id + '\\')"></button>' + 
                            '</div>';
          container.appendChild(toast);

          // 自动移除
          setTimeout(() => removeToast(id), 4000);
        }

        function removeToast(id) {
          const el = document.getElementById(id);
          if (el) el.remove();
        }

      function copyObject(button) {
        const currentURL = window.location.href;
        const getURL =  currentURL + decodeURIComponent(button.dataset.name);
        const result = getURL.replace("https://", "http://").replace("#", "");
        navigator.clipboard.writeText(result);
        // alert(result + " copyed!");
        showToast(result + " copyed!");
      }
      // 下载文件
      function downloadObject(button) {
        const currentURL = window.location.href;
        const getURL =  currentURL + decodeURIComponent(button.dataset.name);
        const link = document.createElement('a');
        link.href = getURL.replace("#", "");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      function deleteFromButton(button) {
        const name = decodeURIComponent(button.dataset.name);
        showToast(name + " delete!");
        deleteFile(name);
      }
      function enterFolderFromLink(link) {
        const folder = decodeURIComponent(link.dataset.folder);
        enterFolder(folder);
      }
      
      

      function goBack() {
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        currentPath = parts.length ? parts.join('/') + '/' : '';
        listFiles();
      }

      async function deleteFile(name) {
        await fetch('/api/delete?name=' + encodeURIComponent(name), { method: 'POST' });
        listFiles();
      }

      async function createFolder() {
        const name = document.getElementById('new-folder').value;
        const folderPath = currentPath + name; // + '/.folder';
        document.getElementById('new-folder').value = '';
        await fetch('/api/create-folder?name=' + encodeURIComponent(folderPath), { method: 'POST' });
        listFiles();
      }

      document.getElementById('upload-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const file = formData.get('file');
        formData.set('file', file, currentPath + file.name);
        await fetch('/api/upload', { method: 'POST', body: formData });
        listFiles();
        // formData.set('file', '', '');
        showToast(file.name + " 上传成功!");
      });

      listFiles();
    </script>
    <div id="toast-container" class="position-fixed top-0 start-0 p-3" style="z-index: 9999;"></div>
    </body>
    </html>`;
}

function redirectToLogin() {
  return new Response(`
  <html>
    <head>
      <meta charset="UTF-8">
    </head>
    <body>
      <div style="text-align:center">
        <form method="POST" action="/auth">
          <input name="password" type="password" placeholder="密码" />
          <button type="submit">登录</button>
        </form>
      </div>
    </body>
  </html>
  `, { headers: { 'Content-Type': 'text/html' } });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');

  switch (url.pathname) {
    case '/api/list':
      const prefix = url.searchParams.get('path') || '';
      const list = await env.MY_BUCKET.list({
        prefix,
        delimiter: '/', // 关键：只列出当前层级
        include: ['httpMetadata', 'customMetadata']
      });

      // 日志输出方便调试
      // console.log('📂 当前路径 prefix:', prefix);
      // console.log('📁 子文件夹 delimitedPrefixes:', list.delimitedPrefixes);
      // console.log('📄 文件 objects:', list.objects.map(o => o.key));

      const folders = (list.delimitedPrefixes || []).map(p => ({ name: p }));
      const files = (list.objects || [])
        .filter(obj => !obj.key.endsWith('.folder')) // 可选：跳过“空文件夹占位符”
        .map(obj => ({name: obj.key,
                      size: obj.size,
                      contentType: obj.httpMetadata?.contentType || 'unknown',
                      lastModified: obj.uploaded?.toISOString() || ''}));

      return Response.json([...folders, ...files]);

    case '/api/upload':
      const formData = await request.formData();
      const file = formData.get('file');
      await env.MY_BUCKET.put(file.name, file.stream());
      return new Response('Uploaded');

    case '/api/delete':
      try {
        await env.MY_BUCKET.delete(name);
        await env.MY_BUCKET.delete(name + '.folder');
        console.log('delete ok');
      } catch (err) {
        console.error('删除失败:', err);
      }
      return new Response('Deleted');

    case '/api/download':
      const key = url.searchParams.get("name");
      const object = await env.MY_BUCKET.get(key);
      if (!object) return new Response("File not found", { status: 404 });

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${key.split('/').pop()}"`,
        }
      });

    case '/api/create-folder':
      await env.MY_BUCKET.put(name.replace(/\/?$/, '/') + '.folder', new Blob());
      return new Response('Folder Created');

    default:
      return new Response('Not found', { status: 404 });
  }
}

// --- 简易 Session ---
const SESSION_COOKIE = 'session_token';

async function generateJWTToken (secretKey, env) {
    const secret = new TextEncoder().encode(secretKey);
    const userID = env.USER;
    return await new SignJWT({ userID })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);
}

async function verifySession(request, env) {
    try {
        const secretKey = env.SESSION_SECRET;
        const secret = new TextEncoder().encode(secretKey);
        const cookie = request.headers.get('Cookie')?.match(/(^|;\s*)jwtToken=([^;]*)/);
        const token = cookie ? cookie[2] : null;

        if (!token) {
            // console.log('Unauthorized: Token not available!');
            return false;
        }

        const { payload } = await jwtVerify(token, secret);
        // console.log(`Successfully logined, User ID: ${payload.userID}`);
        return true;
    } catch (error) {
        // console.log(error);
        return false;
    }
}

async function setSession(env) {
    const jwtToken = await generateJWTToken(env.SESSION_SECRET, env);
    const cookieHeader = 'jwtToken=' + jwtToken + '; HttpOnly; Secure; Max-Age=3600; Path=/; SameSite=Strict';
    return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookieHeader,
      'Location': '/',
    },
    });
}

function clearSession() {
  // console.log('out!');
  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': 'jwtToken=deleted; Max-Age=0; Path=/',
      'Location': '/',
    },
  });
}
