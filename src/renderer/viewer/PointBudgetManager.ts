export class PointBudgetManager {
  private budget = 100_000_000;

  setBudget(pointBudget: number): void {
    this.budget = Math.max(10_000, Math.floor(pointBudget));
  }

  getBudget(): number {
    return this.budget;
  }

  getSamplingStep(totalPoints: number, requestedStep: number): number {
    const budgetStep = Math.max(1, Math.ceil(totalPoints / this.budget));
    return Math.max(1, requestedStep, budgetStep);
  }

  describeMode(totalPoints: number): "Direct PLY Mode" | "Preview Cache Mode" {
    return totalPoints > this.budget ? "Preview Cache Mode" : "Direct PLY Mode";
  }
}
