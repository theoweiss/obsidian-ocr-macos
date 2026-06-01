import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants } from "fs/promises";
import * as path from "path";

const execFileAsync = promisify(execFile);

export class OCRService {
  private cliPath: string;
  private isProcessing: boolean = false;
  private queue: Array<{ imagePath: string; resolve: (text: string) => void; reject: (err: Error) => void }> = [];

  constructor(pluginDir: string) {
    // The ocr-cli binary should be in the plugin directory
    this.cliPath = path.join(pluginDir, "ocr-cli");
  }

  /**
   * Extract text from an image using macOS Vision framework
   */
  async extractText(imagePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ imagePath, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;

    try {
      const text = await this.runOCR(item.imagePath);
      item.resolve(text);
    } catch (error) {
      item.reject(error as Error);
    } finally {
      this.isProcessing = false;
      // Process next item in queue
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  private async runOCR(imagePath: string): Promise<string> {
    try {
      // Pass arguments as a separate argv array so no shell interpretation
      // happens on the image path (filenames may contain ", `, $, \).
      const { stdout, stderr } = await execFileAsync(
        this.cliPath,
        [imagePath],
        {
          timeout: 30000, // 30 second timeout
          maxBuffer: 1024 * 1024, // 1MB buffer for large text
        }
      );

      if (stderr) {
        console.warn("OCR warning:", stderr);
      }

      return stdout.trim();
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(
          "OCR CLI tool not found. Please rebuild the plugin with 'npm run build:swift'"
        );
      }
      if (error.killed) {
        throw new Error("OCR process timed out");
      }
      throw new Error(`OCR failed: ${error.message}`);
    }
  }

  /**
   * Check if the OCR CLI tool is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await access(this.cliPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the number of items in the processing queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
