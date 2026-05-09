# Electron Desktop Overlay

A transparent, always-on-top Electron overlay with a sketch canvas, prompt input, and fluid glassmorphism UI. Designed to overlay on top of applications like Godot games or any desktop application.

## Features

- 🎨 **Sketch Canvas** - Draw and sketch with customizable pen and eraser tools
- 💬 **Prompt Section** - Text area for entering prompts or notes
- 📤 **Image Upload** - Upload and display images on the canvas
- ✨ **Fluid UI** - Glassmorphism design with smooth animations and transitions
- 🪟 **Always On Top** - Overlay stays above all windows including games
- 👆 **Click-Through** - Window is transparent to clicks except on UI elements
- ⌨️ **Keyboard Shortcuts** - Press `Esc` to close the panel

## Installation

1. Install dependencies:
```bash
cd electron-overlay
npm install
```

## Usage

### Start the Overlay

```bash
npm start
```

### Development Mode (with DevTools)

```bash
npm run dev
```

## How to Use

1. **Open Panel**: Click the floating "+" button in the top-right corner
2. **Draw**: 
   - Select pen or eraser tool
   - Choose color and brush size
   - Draw on the canvas
   - Clear canvas with the trash icon
3. **Add Prompt**: Type in the text area below the canvas
4. **Upload Image**: Click "Upload Image" to add an image to the canvas
5. **Close Panel**: Click the X button, press Esc, or click outside the panel

## Features Breakdown

### Drawing Tools
- **Pen Tool** - Draw with customizable color and size
- **Eraser Tool** - Erase parts of your drawing
- **Color Picker** - Choose any color for drawing
- **Brush Size** - Adjust from 1-20 pixels
- **Clear Canvas** - Remove all drawings

### UI Interactions
- **Smooth Animations** - Slide-down panel animation with glassmorphism effect
- **Hover Effects** - Buttons scale and glow on hover
- **Click-Through** - Overlay doesn't interfere with applications below when panel is closed

## File Structure

```
electron-overlay/
├── main.js              # Electron main process
├── preload.js           # IPC bridge for security
├── package.json         # Dependencies and scripts
├── renderer/
│   ├── index.html       # UI structure
│   ├── styles.css       # Glassmorphism styling
│   └── app.js           # Canvas and interaction logic
└── README.md
```

## Keyboard Shortcuts

- `Esc` - Close the panel

## Customization

### Change Panel Position
Edit `styles.css` and modify the `#panel` position:
```css
#panel {
  top: 100px;    /* Adjust vertical position */
  right: 20px;   /* Adjust horizontal position */
}
```

### Change Colors
Modify the gradient in `styles.css`:
```css
background: linear-gradient(135deg, rgba(100, 200, 255, 0.8), rgba(150, 100, 255, 0.8));
```

## Requirements

- Node.js (v16 or higher)
- macOS, Windows, or Linux

## License

MIT
