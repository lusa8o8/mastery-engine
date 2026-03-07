import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics'
import './index.css'
import App from './App.jsx'

const savedTheme = localStorage.getItem('solvd-theme') || 'paper'
document.documentElement.setAttribute('data-theme', savedTheme)

inject()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
