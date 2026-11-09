import { registerEs, type Dict } from '..';
import { esCommon } from './common';
import { esMenu } from './menu';
import { esGame } from './game';
import { esPanels } from './panels';
import { esData } from './data';
import { esStore } from './store';
import { esWiki } from './wiki';

export const ES: Dict = { ...esCommon, ...esMenu, ...esGame, ...esPanels, ...esData, ...esStore, ...esWiki };
registerEs(ES);
