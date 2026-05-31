import chalk from 'chalk';
import logUpdate from 'log-update';

export interface CortexTask {
  id: string;
  type: 'thought' | 'action';
  text: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  meta?: string;
  startTime?: number;
}

export class CortexTerminalUI {
  private tasks: Map<string, CortexTask> = new Map();
  private activeTaskIds: Set<string> = new Set();
  
  private tokenCount: number = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private frameIndex: number = 0;
  // A fluid golden/orange spinner frame: "⠋"
  private readonly spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentActivityName: string = 'Idle';
  private uiStartTime: number = Date.now();

  constructor() {
    this.startRenderLoop();
  }

  private startRenderLoop() {
    if (this.intervalId) return;
    // 80ms refresh cycle
    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
      this.render();
    }, 80);
  }

  /**
   * Stop the animation interval and release the terminal line control.
   */
  public freeze() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Clear the active buffer before releasing control for user input
    logUpdate.clear();
  }

  /**
   * Hook to update token stream counts instantly.
   */
  public incrementTokens(count: number) {
    this.tokenCount += count;
    this.render();
  }

  /**
   * Start a new task.
   */
  public startTask(id: string, text: string, type: 'thought' | 'action' = 'action') {
    this.tasks.set(id, {
      id,
      type,
      text,
      status: 'running',
      startTime: Date.now()
    });
    this.activeTaskIds.add(id);
    this.currentActivityName = text;
    
    // Ensure the loop is running
    this.startRenderLoop();
    this.render();
  }

  /**
   * Update the meta information (sub-details or stats) for a running task.
   */
  public updateMeta(id: string, meta: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.meta = meta;
      this.render();
    }
  }

  /**
   * Complete a task, committing it to the terminal buffer.
   */
  public completeTask(id: string, status: 'success' | 'failed' = 'success', panelContent?: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
      this.activeTaskIds.delete(id);
      
      // Clear the live rendering frame first to prevent duplicate output
      logUpdate.clear();
      
      // Write the finalized task to standard output
      this.printCompletedTask(task, panelContent);
      
      // Re-trigger render to draw the remaining active tasks / sticky status
      this.render();
    }
  }
  
  private printCompletedTask(task: CortexTask, panelContent?: string) {
    // Finished steps/thoughts render a solid green bullet "●" or checkmark "✓"
    const isAction = task.type === 'action';
    const successIcon = isAction ? chalk.green('✓') : chalk.green('●');
    const bullet = task.status === 'success' ? successIcon : chalk.red('✖');
    
    // Bold white title text
    const title = chalk.bold.white(task.text);
    
    // 2-character wide state column (icon + space)
    console.log(`${bullet} ${title}`);
    
    // Sub-details indented with dim branch glyph
    if (task.meta) {
      console.log(chalk.dim(`  └ ${task.meta}`));
    }

    if (panelContent) {
      this.printPanel(panelContent);
    }
  }

  private stripAnsi(str: string): string {
    // Basic ANSI escape code regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  private printPanel(content: string) {
    const lines = content.split('\n');
    const contentWidth = Math.max(...lines.map(l => this.stripAnsi(l).length)); 
    const width = Math.max(contentWidth, 40);
    
    // ASCII border frame perfectly aligned under the task (indented by 2 spaces)
    const top = `  ┌${'─'.repeat(width + 2)}┐`;
    const bottom = `  └${'─'.repeat(width + 2)}┘`;
    
    console.log(chalk.dim(top));
    for (const line of lines) {
      const visibleLength = this.stripAnsi(line).length;
      const pad = ' '.repeat(Math.max(0, width - visibleLength));
      console.log(`  ${chalk.dim('│')} ${line}${pad} ${chalk.dim('│')}`);
    }
    console.log(chalk.dim(bottom));
  }

  private render() {
    if (!this.intervalId) return; // Frozen or stopped
    
    let out = '';
    
    // Render the active task(s) inline
    for (const id of this.activeTaskIds) {
      const task = this.tasks.get(id)!;
      const spinner = chalk.yellow(this.spinnerFrames[this.frameIndex]);
      out += `${spinner} ${chalk.white(task.text)}\n`;
      if (task.meta) {
         out += chalk.dim(`  └ ${task.meta}\n`);
      }
    }
    
    // Sticky Real-Time Status Strip (The final lines of the terminal buffer)
    const elapsedSecs = ((Date.now() - this.uiStartTime) / 1000).toFixed(1);
    const spinner = chalk.yellow(this.spinnerFrames[this.frameIndex]);
    const tokens = chalk.hex('#FFA500')(`⚡ ${this.tokenCount} tokens`);
    
    let activityText = this.currentActivityName;
    if (this.activeTaskIds.size === 0) {
      activityText = 'Idle';
    }
    
    // As per specs: "cyan for numbers/timers", "orange for tokens"
    const activity = chalk.cyan(activityText + '...');
    const timer = chalk.cyan(`${elapsedSecs}s`);
    const hint = chalk.dim('(esc to interrupt)');
    
    const statusStrip = `${spinner} ${activity}  ${timer}  ${tokens}  ${hint}`;
    
    logUpdate(out + statusStrip);
  }
}
