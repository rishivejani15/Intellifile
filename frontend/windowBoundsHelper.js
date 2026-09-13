/**
 * Helper to compute safe window dimensions and coordinates that fit
 * entirely within the screen's usable workArea (excluding taskbar/dock).
 */

function calculateInitialBounds({ workArea, savedState = null }) {
  const maxWidth = Math.max(640, workArea.width - 40);
  const maxHeight = Math.max(480, workArea.height - 40);
  const defaultWidth = Math.min(1360, Math.floor(workArea.width * 0.88));
  const defaultHeight = Math.min(800, Math.floor(workArea.height * 0.85));

  const fallbackWidth = Math.min(defaultWidth, maxWidth);
  const fallbackHeight = Math.min(defaultHeight, maxHeight);
  const fallbackX = Math.floor(workArea.x + (workArea.width - fallbackWidth) / 2);
  const fallbackY = Math.floor(workArea.y + (workArea.height - fallbackHeight) / 2);

  if (savedState && savedState.bounds) {
    const { x, y, width, height } = savedState.bounds;

    const isVisible = (
      x + 80 >= workArea.x &&
      x <= workArea.x + workArea.width - 80 &&
      y >= workArea.y - 10 &&
      y <= workArea.y + workArea.height - 80
    );

    if (isVisible && width >= 400 && height >= 300) {
      const safeWidth = Math.min(width, workArea.width);
      const safeHeight = Math.min(height, workArea.height - 16);
      const safeX = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - safeWidth));
      const safeY = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - safeHeight));

      return {
        x: safeX,
        y: safeY,
        width: safeWidth,
        height: safeHeight,
        isMaximized: !!savedState.isMaximized
      };
    }
  }

  return {
    x: fallbackX,
    y: fallbackY,
    width: fallbackWidth,
    height: fallbackHeight,
    isMaximized: savedState ? !!savedState.isMaximized : false
  };
}

module.exports = {
  calculateInitialBounds,
};
