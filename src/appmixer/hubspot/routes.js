'use strict';

const _ = require('lodash');
const { WATCHED_PROPERTIES_CONTACT, WATCHED_PROPERTIES_DEAL } = require('./commons');

const getSubscriptionEntries = async (context, subscriptionType) => {

    return (await context.service.stateGet(subscriptionType)) || [];
};

module.exports = async (context) => {

    context.http.router.register({
        method: 'POST',
        path: '/subscribe/{subscriptionType}',
        options: {
            auth: false,
            handler: async (req) => {

                const { subscriptionType } = req.params;

                try {
                    const lock = await context.lock(subscriptionType);

                    try {
                        const subscriptions = req.payload;
                        if (!Array.isArray(subscriptions) || !subscriptions.length) {
                            return {};
                        }

                        const response = await context.hubspot.getAllSubscriptions();
                        const currentSubs = response.data.results.map(s => s.eventType);

                        let subscriptionsToCreate = [];
                        subscriptions.forEach(s => {
                            if (!currentSubs.includes(s.subscriptionDetails.subscriptionType)) {
                                subscriptionsToCreate.push(s);
                            }
                        });

                        if (!subscriptionsToCreate.length) {
                            return {};
                        }

                        const { data } = await context.hubspot.createSubscriptions(subscriptions);
                        return data;

                    } finally {
                        await lock.unlock();
                    }

                } catch (err) {
                    if (err.message !== 'locked') {
                        throw err;
                    }
                }

                return {};
            }
        }
    });

    context.http.router.register({
        method: 'DELETE',
        path: '/subscribe/{subscriptionType}',
        options: {
            auth: false,
            handler: async (req) => {

                const { subscriptionType } = req.params;

                try {
                    const lock = await context.lock(subscriptionType);

                    try {
                        const flows = await getSubscriptionEntries(context, subscriptionType);
                        if (flows.length > 1) {
                            // do not delete subscriptions if there are multiple receivers.
                            return {};
                        }

                        const subscriptionIds = [];
                        const { data } = await context.hubspot.getAllSubscriptions();
                        (data.results || [])
                            .forEach(subscription => {
                                if (subscription.eventType === subscriptionType) {
                                    subscriptionIds.push(subscription.id);
                                }
                            });

                        if (subscriptionIds.length) {
                            for (const ids of _.chunk(subscriptionIds, 30)) {
                                await context.hubspot.deleteSubscriptions(ids);
                            }
                        }
                        return true;

                    } finally {
                        await lock.unlock();
                    }

                } catch (err) {
                    if (err.message !== 'locked') {
                        throw err;
                    }
                }

                return {};
            }
        }
    });

    context.http.router.register({
        method: 'POST',
        path: '/events',
        options: {
            auth: false,
            handler: async (req) => {

                await context.log('info', 'hubspot-plugin-route-webhook-hit', { eventCount: req.payload?.length });
                context.log('trace', 'hubspot-plugin-route-webhook-payload', { payload: req.payload });
                if (!req.payload || typeof req.payload !== 'object') {
                    context.log('warn', 'hubspot-plugin-route-webhook-missing-payload');
                    return {};
                }
                const events = Array.isArray(req.payload) ? req.payload : [req.payload];
                if (!Array.isArray(events) || !events.length) {
                    return {};
                }

                let eventCount = 0;

                // Portal ID (hub_id) is the same for all events.
                const portalId = events[0].portalId;
                const eventsBySubscriptionType = _.groupBy(events, 'subscriptionType');

                // Note on batching: The batch size can vary, but will be under 100 notifications.
                // See: https://legacydocs.hubspot.com/docs/methods/webhooks/webhooks-overview
                for (const [subscriptionType, subscriptionEvents] of Object.entries(eventsBySubscriptionType)) {
                    // Skipping propertyChange events for properties that are not watched.
                    const filteredEvents = [];
                    if (subscriptionType.endsWith('propertyChange')) {
                        let watchedProperties = [];
                        if (subscriptionType === 'deal.propertyChange') {
                            watchedProperties = WATCHED_PROPERTIES_DEAL;
                        } else if (subscriptionType === 'contact.propertyChange') {
                            watchedProperties = WATCHED_PROPERTIES_CONTACT;
                        } else {
                            throw new Error(`Unsupported subscriptionType: ${subscriptionType}`);
                        }

                        subscriptionEvents.forEach(event => {
                            if (watchedProperties.includes(event.propertyName)) {
                                filteredEvents.push(event);
                            }
                        });
                    } else {
                        // For creation events, we don't need to filter.
                        filteredEvents.push(...subscriptionEvents);
                    }
                    const eventsByObjectId = _.keyBy(filteredEvents, 'objectId');
                    if (!Object.keys(eventsByObjectId).length) {
                        continue;
                    }

                    context.log('trace', 'hubspot-plugin-route-webhook-log', { eventsByObjectId });
                    const registeredComponents = await context.service.stateGet(`${subscriptionType}:${portalId}`) || [];
                    context.log('trace', 'hubspot-plugin-route-webhook-log', { registeredComponents });
                    // Trigger components concurrently, ensuring a 200 response within 5 seconds
                    Promise.all(registeredComponents.map(registered => {
                        context.log('trace', 'hubspot-plugin-route-webhook-trigger-start', registered);
                        eventCount += 1;
                        return context.triggerComponent(
                            registered.flowId,
                            registered.componentId,
                            eventsByObjectId,
                            {},
                            {}
                        ).catch(err => {
                            context.log('error', err.message, err);
                        });
                    })).catch(err => {
                        context.log('error', err.message, err);
                    });
                }

                context.log('info', 'hubspot-plugin-route-webhook-success', { eventCount });
                return {};
            }
        }
    });
};
