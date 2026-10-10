import assert from "node:assert/strict";

export async function assertSidebarBoundary(sidebar, side = "left") {
  const geometry = await sidebar.evaluate((element, side) => {
    const separator = side === "left" ? element.nextElementSibling : element.previousElementSibling;
    const adjacent = side === "left" ? separator.nextElementSibling : separator.previousElementSibling;
    const panel = element.getBoundingClientRect(), content = adjacent.getBoundingClientRect();
    const grip = separator.firstElementChild.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { gap: side === "left" ? content.left - panel.right : panel.left - content.right,
      gripOffset: grip.left + grip.width / 2 - (side === "left" ? panel.right : panel.left),
      border: side === "left" ? style.borderRightWidth : style.borderLeftWidth,
      separatorBorder: getComputedStyle(separator).borderLeftWidth, gripWidth: grip.width };
  }, side);
  assert.ok(Math.abs(geometry.gap) <= 1, `Adjacent panels share one boundary: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.gripOffset) <= 1, `Grip stays centered on the boundary: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.border, "1px"); assert.equal(geometry.separatorBorder, "0px");
  return geometry;
}
