import { createActions } from 'redux-actions';
import { RestApi } from '@magento/peregrine';

import { closeDrawer } from 'src/actions/app';
import { clearGuestCartId, getCartDetails } from 'src/actions/cart';
import { getCountries } from 'src/actions/directory';

const prefix = 'CHECKOUT';
const actionTypes = ['EDIT', 'RESET'];

// classify action creators by domain
// e.g., `actions.order.submit` => CHECKOUT/ORDER/SUBMIT
// a `null` value corresponds to the default creator function
const actionMap = {
    CART: {
        SUBMIT: null,
        ACCEPT: null,
        REJECT: null
    },
    INPUT: {
        SUBMIT: null,
        ACCEPT: null,
        REJECT: null
    },
    ORDER: {
        SUBMIT: null,
        ACCEPT: null,
        REJECT: null
    }
};

const actions = createActions(actionMap, ...actionTypes, { prefix });
export default actions;

/* async action creators */

const { request } = RestApi.Magento2;

export const resetCheckout = () =>
    async function thunk(dispatch) {
        await dispatch(closeDrawer());
        dispatch(actions.reset());
    };

export const editOrder = section =>
    async function thunk(dispatch) {
        dispatch(actions.edit(section));
    };

export const submitCart = () =>
    async function thunk(dispatch) {
        dispatch(actions.cart.accept());
    };

export const submitInput = payload =>
    async function thunk(dispatch, getState) {
        const { cart } = getState();
        const { guestCartId } = cart;

        if (!guestCartId) {
            throw new Error('Missing required information: guestCartId');
        }

        dispatch(actions.input.submit(payload));
        await dispatch(getCountries());

        const { directory } = getState();
        const { countries } = directory;

        try {
            const address = formatAddress(payload.formValues, countries);
            const response = await request(
                `/rest/V1/guest-carts/${guestCartId}/shipping-information`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        addressInformation: {
                            billing_address: address,
                            shipping_address: address,
                            shipping_method_code: 'flatrate',
                            shipping_carrier_code: 'flatrate'
                        }
                    })
                }
            );

            // refresh cart before returning to checkout overview
            // to avoid flash of old data and layout thrashing
            await dispatch(getCartDetails({ forceRefresh: true }));
            dispatch(actions.input.accept(response));
        } catch (error) {
            dispatch(actions.input.reject(error));
        }
    };

export const submitOrder = () =>
    async function thunk(dispatch, getState) {
        const { cart } = getState();
        const { guestCartId } = cart;

        if (!guestCartId) {
            throw new Error('Missing required information: guestCartId');
        }

        dispatch(actions.order.submit());

        try {
            const response = await request(
                `/rest/V1/guest-carts/${guestCartId}/order`,
                {
                    method: 'PUT',
                    // TODO: replace with real data from cart state
                    body: JSON.stringify({
                        paymentMethod: {
                            method: 'checkmo'
                        }
                    })
                }
            );

            dispatch(actions.order.accept(response));
            clearGuestCartId();
        } catch (error) {
            dispatch(actions.order.reject(error));
        }
    };

/* helpers */

function formatAddress(address = {}, countries = []) {
    const country = countries.find(({ id }) => id === 'US');

    if (!country) {
        throw new Error('Country "US" is not an available country.');
    }

    const { region_code } = address;
    const regions = country.available_regions || [];
    const region = regions.find(({ code }) => code === region_code);

    if (!region) {
        throw new Error(`Region "${region_code}" is not an available region.`);
    }

    return {
        country_id: 'US',
        region_id: region.id,
        region_code: region.code,
        region: region.name,
        ...address
    };
}
