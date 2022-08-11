import { Constraint, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import { modifiedPaths } from '../utils';
import { debug } from '../../plugins/deployment_manager/Utils';

async function getMigrations<T>(context: CometContext, requirements: Requirements): Promise<Migration<T>[]> {
  // TODO: make this configurable from cli params/env var?
  const deployment = context.deploymentManager.deployment; // XXX should become per instance
  const pattern = new RegExp(`deployments/${deployment}/migrations/.*.ts`);
  return await loadMigrations((await modifiedPaths(pattern)).map(p => '../../' + p));
}

function* subsets<T>(array: T[], offset = 0): Generator<T[]> {
  while (offset < array.length) {
    let first = array[offset++];
    for (let subset of subsets(array, offset)) {
      subset.push(first);
      yield subset;
    }
  }
  yield [];
}

async function asyncFilter<T>(els: T[], f: (T) => Promise<boolean>): Promise<T[]> {
  let filterResults = await Promise.all(els.map((el) => f(el)));
  return els.filter((el, i) => filterResults[i]);
}

export class MigrationConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let solutions: Solution<T>[] = [];

    for (let migrationList of subsets(await getMigrations(context, requirements))) {
      solutions.push(async function (ctx: T): Promise<T> {
        const governor = await ctx.getGovernor();
        const proposer = await ctx.getProposer(); // XXX reconcile with Kevins, just unshift into signers?

        migrationList.sort((a, b) => a.name.localeCompare(b.name))
        debug(`Running scenario with migrations: ${JSON.stringify(migrationList.map((m) => m.name))}`);
        for (let migration of migrationList) {
          const artifact = await migration.actions.prepare(ctx.deploymentManager);
          debug(`Prepared migration ${migration.name}.\n  Artifact\n-------\n\n${JSON.stringify(artifact, null, 2)}\n-------\n`);
          // XXX enact will take the 'gov' deployment manager instead of the 'local' one
          await migration.actions.enact(ctx.deploymentManager, artifact);
          debug(`Enacted migration ${migration.name}`);
        }
        return ctx;
      });
    }

    return solutions;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
