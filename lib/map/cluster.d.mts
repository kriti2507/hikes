export interface ClusterPoint {
  order: number;
  x: number;
  y: number;
}

export interface Cluster<T extends ClusterPoint = ClusterPoint> {
  x: number;
  y: number;
  members: T[];
}

export declare function cluster<T extends ClusterPoint>(
  points: T[],
  minSeparation: number,
): Cluster<T>[];
