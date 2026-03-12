/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import { deepEquals } from './utils.js';

export const webext = self.browser || self.chrome;
export const dnr = webext.declarativeNetRequest || {};

// Electron'un extension API kapsamı Chromium'dan daha dar olabiliyor.
// uBOL tarafındaki permissions çağrılarının patlamaması için güvenli fallbackler.
if ( webext.permissions instanceof Object === false ) {
    webext.permissions = {};
}
if ( typeof webext.permissions.getAll !== 'function' ) {
    webext.permissions.getAll = async ( ) => ({
        permissions: [],
        origins: [ '<all_urls>', '*://*/*' ],
    });
}
if ( typeof webext.permissions.request !== 'function' ) {
    webext.permissions.request = async ( ) => true;
}
if ( typeof webext.permissions.contains !== 'function' ) {
    webext.permissions.contains = async ( ) => true;
}
if ( typeof webext.permissions.remove !== 'function' ) {
    webext.permissions.remove = async ( ) => true;
}
if ( webext.permissions.onRemoved instanceof Object === false ) {
    webext.permissions.onRemoved = { addListener() {}, removeListener() {} };
}
if ( webext.permissions.onAdded instanceof Object === false ) {
    webext.permissions.onAdded = { addListener() {}, removeListener() {} };
}

/******************************************************************************/

export function normalizeDNRRules(rules, ruleIds) {
    if ( Array.isArray(rules) === false ) { return rules; }
    return Array.isArray(ruleIds)
        ? rules.filter(rule => ruleIds.includes(rule.id))
        : rules;
}

/******************************************************************************/

dnr.setAllowAllRules = async function(id, allowed, notAllowed, reverse, priority) {
    const [
        beforeDynamicRules,
        beforeSessionRules,
    ] = await Promise.all([
        dnr.getDynamicRules({ ruleIds: [ id+0 ] }),
        dnr.getSessionRules({ ruleIds: [ id+1 ] }),
    ]);
    const addDynamicRules = [];
    const addSessionRules = [];
    if ( reverse || allowed.length || notAllowed.length ) {
        const rule0 = {
            id: id+0,
            action: { type: 'allowAllRequests' },
            condition: {
                resourceTypes: [ 'main_frame' ],
            },
            priority,
        };
        if ( allowed.length ) {
            rule0.condition.requestDomains = allowed.slice();
        } else if ( notAllowed.length ) {
            rule0.condition.excludedRequestDomains = notAllowed.slice();
        }
        addDynamicRules.push(rule0);
        // https://github.com/uBlockOrigin/uBOL-home/issues/114
        // https://github.com/uBlockOrigin/uBOL-home/issues/247
        const rule1 = {
            id: id+1,
            action: { type: 'allow' },
            condition: {
                tabIds: [ webext.tabs.TAB_ID_NONE ],
            },
            priority,
        };
        if ( allowed.length ) {
            rule1.condition.initiatorDomains = allowed.slice();
        } else if ( notAllowed.length ) {
            rule1.condition.excludedInitiatorDomains = notAllowed.slice();
        }
        addSessionRules.push(rule1);
    }
    const promises = [];
    const modified = deepEquals(addDynamicRules, beforeDynamicRules) === false;
    if ( modified ) {
        promises.push(
            dnr.updateDynamicRules({
                addRules: addDynamicRules,
                removeRuleIds: beforeDynamicRules.map(r => r.id),
            })
        );
    }
    if ( deepEquals(addSessionRules, beforeSessionRules) === false ) {
        promises.push(
            dnr.updateSessionRules({
                addRules: addSessionRules,
                removeRuleIds: beforeSessionRules.map(r => r.id),
            })
        );
    }
    return Promise.all(promises).then(( ) => modified).catch(( ) => false);
};
