import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// Service Worker ကို Register လုပ်ခြင်းဖြင့် App အား Install လုပ်နိုင်စေရန် ဖန်တီးပေးခြင်း
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)