export class AlbumEditGeneration {
  private generation = 0;

  advance(): number {
    return ++this.generation;
  }

  isCurrent(candidate: number): boolean {
    return candidate === this.generation;
  }
}
