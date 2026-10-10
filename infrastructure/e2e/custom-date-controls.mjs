/** Interact with the actual calendar and its custom lists, rather than writing hidden form fields. */
export async function chooseDateInput(page, trigger, value) {
  await trigger.click();
  const panel = page.locator('[data-custom-date-panel]').last();
  const date = value.slice(0, 10);
  const [year, month] = date.split('-');
  await panel.getByRole('combobox', { name: 'Год', exact: true }).click();
  await page.getByRole('option', { name: year, exact: true }).click();
  await panel.getByRole('combobox', { name: 'Месяц', exact: true }).click();
  await page.getByRole('option', { name: new Intl.DateTimeFormat('ru', { month: 'long' }).format(new Date(2024, Number(month) - 1, 1)), exact: true }).click();
  await panel.locator(`button[data-date-key="${date}"]`).click();
  if (value.includes('T')) {
    const [hours, minutes] = value.slice(11).split(':');
    await chooseTimeParts(page, panel, hours, minutes);
    await panel.getByRole('button', { name: 'Применить', exact: true }).click();
  }
}

export async function chooseTimeInput(page, trigger, value) {
  await trigger.click();
  const panel = page.locator('[data-custom-date-panel]').last();
  const [hours, minutes] = value.split(':');
  await chooseTimeParts(page, panel, hours, minutes);
  await panel.getByRole('button', { name: 'Применить', exact: true }).click();
}

async function chooseTimeParts(page, panel, hours, minutes) {
  await panel.getByRole('combobox', { name: 'Часы', exact: true }).click();
  await page.getByRole('option', { name: hours, exact: true }).click();
  await panel.getByRole('combobox', { name: 'Минуты', exact: true }).click();
  await page.getByRole('option', { name: minutes, exact: true }).click();
}
