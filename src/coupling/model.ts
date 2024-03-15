import { Uri } from 'vscode';

export interface Coupling {
  entity: string;
  coupled: string;
  degree: number;
  averageRevs: number;
}

/**
 * Represents a node in the tree views for coupled files.
 */
export interface CoupledEntity {
  entityName: string;
  resourceUri?: Uri;
  couplings: CoupledEntity[];
  parent?: CoupledEntity;
  degree?: number;
}
