const STATION_LOGIN_ORIGIN = 'https://ai.phuketcore.com';

function allowedNavigation(value) {
  try { const url = new URL(value); return url.origin === STATION_LOGIN_ORIGIN && !url.username && !url.password; } catch { return false; }
}

function createStationLogin({ BrowserWindow, session, Menu, dialog, auth }) {
  let login = null, busy = false;
  async function open() {
    if (login && !login.isDestroyed()) { login.show(); login.focus(); return true; }
    const consent = await dialog.showMessageBox({
      type: 'question', title: '授权站点账单', message: '登录 PhuketAI 并授权本机迷迭香读取余额和账单？',
      detail: '仅连接 https://ai.phuketcore.com。此站点未提供已验证的只读 OAuth，登录凭据本身可能具有账户其他权限。插件仅查询账户、账单并续期登录，不充值、不修改账户。\n密码只在站点页面输入；确认后登录凭据通过 Windows 加密保存，不进入分享包。请使用邮箱登录，完成后点击窗口菜单“授权 > 完成登录并授权”。',
      buttons: ['取消', '打开登录窗口'], defaultId: 0, cancelId: 0,
    });
    if (consent.response !== 1) return false;
    const isolated = session.fromPartition('dragon-login-' + require('node:crypto').randomUUID());
    isolated.setPermissionRequestHandler((_web, _permission, done) => done(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on('will-download', event => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, done) => {
      let allowed = allowedNavigation(details.url);
      try {
        const u = new URL(details.url);
        allowed ||= details.resourceType !== 'mainFrame' && u.origin === 'https://challenges.cloudflare.com';
      } catch {}
      done({ cancel: !allowed });
    });
    const win = login = new BrowserWindow({
      width: 980, height: 760, minWidth: 640, minHeight: 520, title: 'PhuketAI 登录 - 完成后点击“授权”菜单',
      webPreferences: { session: isolated, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const eventName of ['will-navigate', 'will-redirect']) win.webContents.on(eventName, (event, url) => {
      if (!allowedNavigation(url)) event.preventDefault();
    });
    win.setMenu(Menu.buildFromTemplate([{ label: '授权', submenu: [
      { label: '完成登录并授权', click: async () => {
        if (busy || win.isDestroyed()) return;
        busy = true;
        try {
          if (!allowedNavigation(win.webContents.getURL())) throw new Error('Wrong origin');
          const confirmation = await dialog.showMessageBox(win, {
            type: 'question', title: '保存授权', message: '将这个账号的登录授权加密保存在本机？',
            detail: '插件将读取余额、最近账单并在登录到期时续期。解除本机授权可在迷迭香用量面板操作。',
            buttons: ['取消', '确认授权'], defaultId: 0, cancelId: 0,
          });
          if (confirmation.response !== 1 || win.isDestroyed()) return;
          const value = await win.webContents.executeJavaScript(`(() => {
            if (location.origin !== 'https://ai.phuketcore.com') return null;
            const read = k => { const v = localStorage.getItem(k); return v && v.length <= 16384 ? v : null; };
            return { accessToken: read('auth_token'), refreshToken: read('refresh_token') };
          })()`);
          await auth.authorize(value);
          await dialog.showMessageBox(win, { type: 'info', message: '授权成功', detail: '可以关闭登录窗口，回到迷迭香用量面板刷新余额。' });
          win.close();
        } catch {
          if (!win.isDestroyed()) await dialog.showMessageBox(win, { type: 'warning', message: '尚未取得有效授权', detail: '请先完成站点登录，再点击“完成登录并授权”。网络或 Windows 加密不可用时不会明文保存凭据。' });
        } finally { busy = false; }
      } },
      { label: '取消并关闭', click: () => win.close() },
    ] }]));
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    win.on('closed', () => {
      if (login === win) login = null;
      isolated.clearStorageData().catch(() => {});
      isolated.clearCache().catch(() => {});
      finish(true);
    });
    await win.loadURL(STATION_LOGIN_ORIGIN + '/login').catch(() => {});
    return completed;
  }
  return { open, close: () => { if (login && !login.isDestroyed()) login.destroy(); } };
}
module.exports = { createStationLogin, allowedNavigation };
