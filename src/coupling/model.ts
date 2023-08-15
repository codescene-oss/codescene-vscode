import * as vscode from 'vscode';

/**
 * Represents a node in the tree views for coupled files.
 */
export interface CoupledEntity {
  entityName: string;
  resourceUri?: vscode.Uri;
  couplings: CoupledEntity[];
  parent?: CoupledEntity;
  degree?: number;
}