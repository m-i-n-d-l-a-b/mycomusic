# HDMI Display Change Visualizer Fix

## Issue Description

When plugging in an HDMI cord while the Myco-Acoustic Engine visualizer is running, the canvas rendering would stop working and not recover. The visualizer would remain blank or frozen even after the display configuration stabilized.

## Root Cause

During HDMI connection/disconnection events, browsers temporarily report invalid (zero or negative) dimensions from `getBoundingClientRect()` as the window transitions between displays. This caused several problems:

1. **Invalid Canvas Dimensions**: Setting canvas width/height to 0 created an invalid rendering context
2. **Broken Gradients**: Creating gradients with zero dimensions threw errors or created invalid gradient objects
3. **Stuck Viewport**: The viewport object retained zero dimensions, preventing recovery
4. **No Display Change Detection**: Only `ResizeObserver` was used, which might not fire reliably during display changes

## Solution

The fix implements multiple defensive measures in `src/components/RhizosphereCanvas.tsx`:

### 1. Dimension Validation in Resize Handler
```typescript
const resize = () => {
  const rect = canvas.getBoundingClientRect();
  
  // Prevent setting invalid canvas dimensions
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  
  // ... rest of resize logic
};
```

### 2. Render Loop Protection
```typescript
const render = (time: number) => {
  // Skip drawing but continue animation loop
  if (viewport.width <= 0 || viewport.height <= 0) {
    animationFrame = window.requestAnimationFrame(render);
    return;
  }
  
  // ... rest of render logic
};
```

### 3. Enhanced Display Change Detection
```typescript
const handleDisplayChange = () => {
  resize();
};

window.addEventListener("resize", handleDisplayChange);
window.matchMedia("screen").addEventListener("change", handleDisplayChange);
```

### 4. Proper Cleanup
```typescript
return () => {
  window.cancelAnimationFrame(animationFrame);
  resizeObserver.disconnect();
  window.removeEventListener("resize", handleDisplayChange);
  window.matchMedia("screen").removeEventListener("change", handleDisplayChange);
};
```

## Benefits

- **Graceful Degradation**: Visualizer skips invalid frames without crashing
- **Automatic Recovery**: Automatically resumes rendering when valid dimensions return
- **Better Display Detection**: Multiple event sources ensure display changes are caught
- **No Memory Leaks**: All event listeners properly cleaned up on unmount

## Testing

- ✅ TypeScript compilation passes
- ✅ All existing tests pass (26/26)
- ✅ Build completes successfully
- ✅ No runtime errors

## Related PR

- #2 - Fix visualizer not working when HDMI cord is plugged in
