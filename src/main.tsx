import './os/migrate' // must run before the stores read localStorage
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import Desktop from './shell/Desktop'
import { bootstrap } from './os/bootstrap'

bootstrap()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Desktop />
  </React.StrictMode>,
)
