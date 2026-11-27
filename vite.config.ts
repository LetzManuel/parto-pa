import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base: the same build works on test-pa.parto.at and under letzmanuel.github.io/parto-pa/.
export default defineConfig({ base: './', plugins: [react()] })
