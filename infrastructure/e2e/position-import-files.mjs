import { zipSync, strToU8 } from "../../backend-execution/node_modules/fflate/esm/browser.js";

const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function letter(index) { let result = "", n = index + 1; while (n) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26); } return result; }

export function spreadsheetFile(rows, date1904 = false) {
  const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((row, ri) => '<row r="' + (ri + 1) + '">' + row.map((value, ci) => {
    const ref = letter(ci) + (ri + 1);
    if (value && typeof value === "object" && "date" in value) {
      const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
      const serial = (Date.parse(value.date + "T00:00:00Z") - epoch) / 86_400_000;
      return '<c r="' + ref + '" s="1"><v>' + serial + '</v></c>';
    }
    if (typeof value === "number") return '<c r="' + ref + '"><v>' + value + '</v></c>';
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
  }).join("") + '</row>').join("") + '</sheetData></worksheet>';
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/hidden.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/data.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="' + (date1904 ? 1 : 0) + '"/><sheets><sheet name="Справка" sheetId="1" r:id="rHidden" state="hidden"/><sheet name="Позиции" sheetId="2" r:id="rData"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHidden" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/hidden.xml"/><Relationship Id="rData" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/data.xml"/><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "xl/styles.xml": strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'),
    "xl/worksheets/hidden.xml": strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="inlineStr"><is><t>Не импортировать справку</t></is></c></row></sheetData></worksheet>'),
    "xl/worksheets/data.xml": strToU8(sheet),
  }));
}

export function delimitedFile(rows, delimiter = ",", encoding = "UTF8") {
  const text = rows.map(row => row.map(value => '"' + String(value && typeof value === "object" ? value.date : value).replaceAll('"', '""') + '"').join(delimiter)).join("\r\n");
  if (encoding === "BOM") return Buffer.from("\uFEFF" + text);
  if (encoding === "CP1251") {
    return Buffer.from([...text].map(char => {
      const n = char.codePointAt(0);
      if (n < 128) return n;
      if (n >= 0x410 && n <= 0x44f) return n - 0x350;
      if (n === 0x401) return 0xa8;
      if (n === 0x451) return 0xb8;
      if (char === "—") return 0x97;
      if (char === "·") return 0xb7;
      throw new Error("Unrepresentable fixture character");
    }));
  }
  return Buffer.from(text);
}

export function positionImportCases(domain) {
  const cases = [];
  for (const layout of ["WIDE", "LONG"]) {
    for (const format of ["CSV_BOM", "CSV_1251", "TSV", "XLSX", "XLSX_1904"]) {
      const prefix = layout + " " + format;
      const a = prefix + " запрос, с кавычкой \"тест\"", b = prefix + " нет позиции", c = prefix + " без замера";
      const first = `https://${domain}/${layout.toLowerCase()}/old`, last = `https://${domain}/${layout.toLowerCase()}/new`;
      const rows = layout === "WIDE" ? [
        ["Запрос", "Целевой URL", "06.10.2026", "URL · 06.10.2026", "2026-10-08", "URL · 2026-10-08"],
        [a, `https://${domain}/target`, 7, first, 3, last], [b, "", "--", "", 12, last], [c, "", "", "", "", ""],
      ] : [
        ["Запрос", "Дата", "Поисковик", "Город", "Устройство", "Позиция", "URL из поиска", "Целевой URL"],
        [a, { date: "2026-10-06" }, "Яндекс", "Москва", "ПК", 7, first, `https://${domain}/target`],
        [a, { date: "2026-10-08" }, "Google", "Москва", "Телефон", 3, last, `https://${domain}/target`],
        [b, { date: "2026-10-06" }, "Яндекс", "Москва", "ПК", "--", "", ""],
        [b, { date: "2026-10-08" }, "Google", "Москва", "Телефон", 12, last, ""],
        [c, { date: "2026-10-08" }, "Яндекс", "Москва", "ПК", "", "", ""],
      ];
      const xlsx = format.startsWith("XLSX");
      const name = prefix.replaceAll(" ", "-") + (xlsx ? ".xlsx" : format === "TSV" ? ".tsv" : ".csv");
      const buffer = xlsx ? spreadsheetFile(rows, format === "XLSX_1904") : delimitedFile(rows, format === "TSV" ? "\t" : format === "CSV_1251" ? ";" : ",", format === "CSV_BOM" ? "BOM" : format === "CSV_1251" ? "CP1251" : "UTF8");
      const laterEngine = layout === "LONG" ? "GOOGLE" : "YANDEX", laterDevice = layout === "LONG" ? "MOBILE" : "DESKTOP";
      const expected = [[a,"2026-10-06","YANDEX","DESKTOP",7,first], [a,"2026-10-08",laterEngine,laterDevice,3,last],
        [b,"2026-10-06","YANDEX","DESKTOP",null,null], [b,"2026-10-08",laterEngine,laterDevice,12,last]];
      cases.push({ name, buffer, layout, expected, missingKeyword: c, targetKeyword: a, targetUrl: `https://${domain}/target` });
    }
  }
  const rows = [["Запрос", "Дата", "Позиция", "URL из поиска", "Целевой URL"]];
  const expected = [];
  for (let index = 0; index < 500; index++) {
    const keyword = `LONG load запрос ${String(index).padStart(4, "0")}`, url = `https://${domain}/load/${index}`;
    rows.push([keyword, "08.10.2026", 1 + index % 100, url, `https://${domain}/target`]);
    expected.push([keyword, "2026-10-08", "YANDEX", "DESKTOP", 1 + index % 100, url]);
  }
  cases.push({ name: "LONG-load.csv", buffer: delimitedFile(rows), layout: "LONG", expected, expectedKeywordCount: 500,
    missingKeyword: "never imported", targetKeyword: "LONG load запрос 0000", targetUrl: `https://${domain}/target` });
  return cases;
}
