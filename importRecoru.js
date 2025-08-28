require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function login(page) {
  await page.goto("https://app.recoru.in/ap/", { waitUntil: "networkidle2" });
  await page.type("#contractId", process.env.RECORU_CONTRACTID);
  await page.type("#authId", process.env.RECORU_USER);
  await page.type("#password", process.env.RECORU_PASS);
  //await page.click("#submit");
  //await page.waitForNavigation();
}

// async function uploadFile(page, filePath) {
//   await page.goto("https://recoru.jp/import");
//   const inputUpload = await page.$("input[type=file]");
//   await inputUpload.uploadFile(filePath);
//   await page.click("#submit");
//   await page.waitForNavigation();
//   console.log(`アップロード完了: ${filePath}`);
// }

async function main() {
  //const dir = "C:/recoru/data"; // TXT 파일 위치
  //const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await login(page);

  //for (const file of files) {
  //  await uploadFile(page, path.join(dir, file));
  //}

  await browser.close();
}

main();
