declare module 'earcut' {
  /** Triangulate a polygon (flat coordinates, optional hole start indices); returns triangle vertex indices. */
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
}
