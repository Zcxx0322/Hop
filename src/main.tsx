import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './store/AppStore';
import { ensureTransportConfig } from './api/config';
import { hydrateNotes } from './store/notes';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/base.css';
import './styles/shell.css';

// 先确定「真实网关 / 演示模式」，再渲染：仓储与传输层据此选择实现。
await ensureTransportConfig();
// 笔记存在磁盘上，启动时拉一次，避免打开笔记页才闪一下
void hydrateNotes();

const container = document.getElementById('root');

if (!container) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
