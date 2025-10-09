require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const configPath = path.join(process.cwd(), "config.json");
if (!fs.existsSync(configPath)) {
  console.error(
    "⚠ config.json が見つかりません。EXEと同じフォルダに配置してください。"
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// タイムスタンプ作成
const now = new Date();
const timestamp =
  now.getFullYear() +
  String(now.getMonth() + 1).padStart(2, "0") +
  String(now.getDate()).padStart(2, "0") +
  String(now.getHours()).padStart(2, "0") +
  String(now.getMinutes()).padStart(2, "0");

// エラーログ保存ディレクトリ
const ERROR_LOG_DIR = config.error.ERROR_LOG_DIR;
if (!fs.existsSync(ERROR_LOG_DIR))
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });

// エラーファイル名生成
function getErrorFileName(srcFile, ts) {
  const baseName = path.basename(srcFile, ".txt");
  return baseName + "_error_" + ts + ".txt";
}

// ログイン処理
async function login(page) {
  await page.goto("https://app.recoru.in/ap/", { waitUntil: "networkidle2" });
  await page.type("#contractId", config.recoru.RECORU_CONTRACTID);
  await page.type("#authId", config.recoru.RECORU_USER);
  await page.type("#password", config.recoru.RECORU_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="button"]'),
  ]);
  await page.click("#m2");
}

// インポート画面に移動
async function goToImportMenu(page) {
  console.log("STEP1: メニューの [勤務データをインポートする] を待機");
  await page.waitForSelector("a.link.icon.icon-file-upload", { visible: true });
  console.log("STEP2: クリック");
  await page.click("a.link.icon.icon-file-upload");
  console.log("STEP3: モーダルに『勤務表のインポート』テキストを待機");
  await page.waitForFunction(
    "document.body.innerText.includes('勤務表のインポート')",
    { timeout: 60000 }
  );
  console.log("STEP4: モーダル本体待機");
  await page.waitForSelector(".modal-window", { timeout: 60000 });
  await page.waitForFunction(
    "function(){var modal=document.querySelector('.modal-window'); if(!modal) return false; var style=window.getComputedStyle(modal); return style.display!=='none'&&style.visibility!=='hidden';}"
  );
  await new Promise(function (resolve) {
    setTimeout(resolve, 1500);
  });
}

// ファイルアップロード処理
async function uploadFile(page, filePath) {
  await goToImportMenu(page);
  console.log("STEP5: ファイルアップロード");

  const inputUpload = await page.$("#file");
  await inputUpload.uploadFile(filePath);

  // changeイベント発火
  await page.evaluate(
    "document.querySelector('#file').dispatchEvent(new Event('change', {bubbles:true}))"
  );

  console.log("STEP6: 確認ボタン有効化待機");
  await page.waitForFunction(
    "document.querySelector('#CHECK-BTN') && !document.querySelector('#CHECK-BTN').disabled",
    { timeout: 10000 }
  );

  console.log("STEP7: 確認ボタンをクリック");
  await page.click("#CHECK-BTN");

  // エラー表示チェック
  const errorDiv = await page
    .waitForSelector("div.custom-scrollbar.message-err-div", {
      visible: true,
      timeout: 2000,
    })
    .catch(function () {
      return null;
    });

  if (errorDiv) {
    const errorMessages = await page.$$eval(
      "div.custom-scrollbar.message-err-div label.message-err",
      "Array.from(document.querySelectorAll('div.custom-scrollbar.message-err-div label.message-err')).map(function(el){return el.innerText;}).join('\\n')"
    );
    console.log("⚠ エラー発生: " + filePath + " -\n" + errorMessages);

    const errorFilePath = path.join(
      ERROR_LOG_DIR,
      getErrorFileName(filePath, timestamp)
    );
    fs.writeFileSync(errorFilePath, errorMessages, "utf8");
    console.log("📄 エラーログ保存: " + errorFilePath);

    const cancelBtn = await page.waitForSelector(
      'input.common-btn[value="閉じる"]'
    );
    await cancelBtn.click();
    await page.waitForSelector(".modal-window", { hidden: true });
    return false;
  }

  console.log("STEP8: インポート実行ボタンをクリック");
  const importBtn = await page.waitForSelector(
    'input.common-btn.submit[value="インポートを実行する"]',
    { visible: true, timeout: 10000 }
  );
  await importBtn.click();
  await new Promise(function (resolve) {
    setTimeout(resolve, 1500);
  });
  console.log("STEP8完了: 1ファイル分処理終了");
  return true;
}

// メール送信
async function sendMail(logPath, logContent, failedFiles) {
  const transporter = nodemailer.createTransport({
    host: "smtp.worksmobile.com",
    port: 587,
    secure: false,
    auth: { user: config.from.LINE_USER, pass: config.from.LINE_PASS },
    tls: { rejectUnauthorized: false },
  });
  const attachments = [];

  // 実行結果ログファイル添付
  if (logPath && fs.existsSync(logPath)) {
    attachments.push({ filename: path.basename(logPath), path: logPath });
  }

  if (failedFiles && failedFiles.length > 0) {
    for (let i = 0; i < failedFiles.length; i++) {
      const file = failedFiles[i];

      // 失敗ファイルのエラーログファイル添付
      const errorFilePath = path.join(
        ERROR_LOG_DIR,
        getErrorFileName(file, timestamp)
      );
      if (fs.existsSync(errorFilePath)) {
        attachments.push({
          filename: path.basename(errorFilePath),
          path: errorFilePath,
        });
      }

      // 失敗した原本ファイル添付
      const originalFilePath = path.join(dataDir, file); // ファイル移動前なら元の経路
      const uploadedFilePath = path.join(uploadedDir, file); // 移動後なら移動したファイル経路
      const fileToAttach = fs.existsSync(uploadedFilePath)
        ? uploadedFilePath
        : originalFilePath;

      if (fs.existsSync(fileToAttach)) {
        attachments.push({
          filename: path.basename(fileToAttach),
          path: fileToAttach,
        });
      }
    }
  }
  const mailOptions = {
    from: config.from.LINE_USER,
    to: config.mail.MAIL_TO,
    subject: "勤務データアップロード結果",
    text: logContent,
    attachments: attachments,
  };
  await transporter.sendMail(mailOptions);
  console.log("📧 メール送信完了");
}

const uploadedDir = path.isAbsolute(config.uploaded.UPLOADED_DIR)
  ? config.uploaded.UPLOADED_DIR
  : path.join(path.dirname(process.execPath), config.uploaded.UPLOADED_DIR);

const dataDir = path.resolve(config.data.DATA_DIR)
  ? config.data.DATA_DIR
  : path.join(path.dirname(process.execPath), config.data.DATA_DIR);

function moveFile(srcFilePath, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const fileName = path.basename(srcFilePath);
  const destFilePath = path.join(destDir, fileName);

  fs.renameSync(srcFilePath, destFilePath); // 파일 이동
  console.log(`✅ ファイルを移動しました: ${destFilePath}`);
}

// メイン処理
async function main() {
  const dir = config.data.DATA_DIR;
  const files = fs.readdirSync(dir).filter(function (f) {
    return f.endsWith(".txt");
  });
  if (files.length === 0) {
    console.log("⚠ 選択するファイルがありません。");
    const logPath = path.join(
      config.result.RESULT_DIR,
      "upload_result_" + timestamp + ".txt"
    );
    const logContent = "選択するファイルがありません。";
    fs.writeFileSync(logPath, logContent, "utf8");
    await sendMail(logPath, logContent, []);
    return;
  }
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: config.chrome.CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
    defaultViewport: null,
  });
  const page = await browser.newPage();
  page.on("dialog", async function (dialog) {
    console.log("⚠ ダイアログ検出: " + dialog.message());
    await dialog.accept();
  });
  await login(page);
  const failedFiles = [];
  const successFiles = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(dataDir, file);
    console.log("アップロード開始: " + file);
    await goToImportMenu(page);
    const ok = await uploadFile(page, filePath);
    if (!ok) {
      failedFiles.push(file);
    } else {
      successFiles.push(file);
    }
    moveFile(filePath, uploadedDir);
  }
  await browser.close();
  const logPath = path.join(
    config.result.RESULT_DIR,
    "upload_result_" + timestamp + ".txt"
  );
  const logContent =
    "=== 登録失敗ファイル一覧 ===\n" +
    (failedFiles.length > 0 ? failedFiles.join("\n") + "\n" : "なし\n") +
    "\n=== 登録成功ファイル一覧 ===\n" +
    (successFiles.length > 0 ? successFiles.join("\n") + "\n" : "なし\n");
  fs.writeFileSync(logPath, logContent, "utf8");
  console.log("📄 結果保存: " + logPath);
  await sendMail(logPath, logContent, failedFiles);
}

(async function mainWrapper() {
  try {
    await main();
  } catch (err) {
    const errorLogPath = path.join(
      ERROR_LOG_DIR,
      `task_error_${timestamp}.txt`
    );

    // err.stackあったスタックを含む
    // なかったらerr.toString()
    fs.writeFileSync(errorLogPath, err.stack || err.toString(), "utf8");

    // コンソール出力
    console.error("💥 タスク実行中にエラー発生:", err);
    console.log("📄 タスクエラーを保存:", errorLogPath);

    // メールで伝送可能
    try {
      await sendMail(errorLogPath, "タスクスケジューラ実行中にエラー発生", []);
    } catch (mailErr) {
      console.error("⚠ メール送信失敗:", mailErr);
    }
  }
})();
