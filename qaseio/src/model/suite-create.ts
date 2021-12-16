/* tslint:disable */
/* eslint-disable */
/**
 * Qase.io API
 * Qase API Specification.
 *
 * The version of the OpenAPI document: 1.0.0
 * Contact: support@qase.io
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */



/**
 * 
 * @export
 * @interface SuiteCreate
 */
export interface SuiteCreate {
    /**
     * Test suite title.
     * @type {string}
     * @memberof SuiteCreate
     */
    'title': string;
    /**
     * Test suite description.
     * @type {string}
     * @memberof SuiteCreate
     */
    'description'?: string;
    /**
     * Test suite preconditions
     * @type {string}
     * @memberof SuiteCreate
     */
    'preconditions'?: string;
    /**
     * Parent suite ID
     * @type {number}
     * @memberof SuiteCreate
     */
    'parent_id'?: number | null;
}
