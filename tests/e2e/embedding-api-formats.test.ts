import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 90_000 });

async function openEmbeddingServices(window: Page) {
  await window.getByRole("button", { name: /主菜单|设置/ }).click();
  const settingsMenuItem = window.getByRole("menuitem", { name: "设置", exact: true });
  if (await settingsMenuItem.isVisible()) await settingsMenuItem.click();
  await window.getByRole("tab", { name: "语义搜索", exact: true }).click();
  await window.getByRole("button", { name: "添加服务", exact: true }).click();
}

test("saves the chosen embedding API format and restores it after a full restart", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-api-formats-"));
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () => electron.launch({
    timeout: 30_000,
    args: [applicationDirectory], cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1", SERPENT_E2E_HIDE_WINDOW: "1",
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "profile"),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, "API fixture"),
    },
  });
  let application: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    application = await launch();
    let window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称", exact: true }).fill("API fixture");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await openEmbeddingServices(window);
    const formats = window.locator(".embedding-api-options");
    await expect(formats.getByRole("radio")).toHaveCount(3);
    await expect(formats.locator(".ai-config-hint")).toHaveCount(3);
    await expect(formats.getByText("用于文本向量服务，如 Ollama 的兼容接口。")).toBeVisible();
    await expect(formats.getByText("连接支持图文向量的 llama.cpp 服务。")).toBeVisible();
    await expect(formats.getByText("连接使用 DashScope 格式的多模态向量服务。")).toBeVisible();
    for (const name of ["OpenAI 兼容", "DashScope 多模态", "llama.cpp 多模态"]) {
      await formats.getByRole("radio", { name, exact: true }).click();
      await expect(formats.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "true");
    }
    await window.locator("#embedding-service-name").fill("Synthetic API service");
    await window.locator("#embedding-service-url").fill("http://127.0.0.1:8080/v1");
    await window.locator("#embedding-service-model").fill("synthetic-model");
    await window.locator(".semantic-service-form").getByRole("button", { name: "保存", exact: true }).click();
    await expect(window.locator(".semantic-service-form")).toHaveCount(0);
    await application.close();
    application = await launch();
    window = await application.firstWindow();
    // Reopen the isolated fixture library, then inspect its persisted global service.
    const openLibrary = window.getByRole("button", { name: "打开资源库", exact: true });
    if (await openLibrary.isVisible()) await openLibrary.click();
    await window.getByRole("button", { name: /主菜单|设置/ }).click();
    const settingsMenuItem = window.getByRole("menuitem", { name: "设置", exact: true });
    if (await settingsMenuItem.isVisible()) await settingsMenuItem.click();
    await window.getByRole("tab", { name: "语义搜索", exact: true }).click();
    await expect(window.getByText("Synthetic API service", { exact: true })).toBeVisible();
    await window.locator(".semantic-model-list").getByRole("button", { name: "编辑", exact: true }).click();
    await expect(window.getByRole("radio", { name: "llama.cpp 多模态", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(window.locator("#embedding-service-url")).toHaveValue("http://127.0.0.1:8080/v1");
  } finally {
    await application?.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
