/*
 * Copyright (C) 2013 - 2014 TopCoder Inc., All Rights Reserved.
 *
 * @version 1.9
 * @author Sky_, mekanizumu, TCSASSEMBLER, freegod, Ghost_141, TCSASSEMBLER
 * @changes from 1.0
 * merged with Member Registration API
 * changes in 1.1:
 * 1. add stub for Get Studio Challenge Detail
 * changes in 1.2:
 * 1. Add an optional parameter to search challenge api - cmc
 * 2. Display cmc value search challenge and challenge detail API response.
 * 3. Remove challenge description from search challenge API response.
 * changes in 1.3:
 * 1. move studio API to separated file
 * changes in 1.4:
 *  - Use empty result set instead of 404 error in get challenges API.
 * changes in 1.5:
 * 1. Update the logic when get results from database since the query has been updated.
 * changes in 1.6:
 * merge the backend logic of search software challenges and studio challenges together.
 * changes in 1.7:
 * support private challenge for get software/studio challenge detail api.
 * changes in 1.8:
 * Added methods for getting terms of use by challenge or directly by id
 * changes in 1.9:
 * Added method for uploading submission to a develop challenge
 */
"use strict";

require('datejs');
var fs = require('fs');
var async = require('async');
var S = require('string');
var _ = require('underscore');
var request = require('request');

var IllegalArgumentError = require('../errors/IllegalArgumentError');
var UnauthorizedError = require('../errors/UnauthorizedError');
var NotFoundError = require('../errors/NotFoundError');
var ForbiddenError = require('../errors/ForbiddenError');
var BadRequestError = require('../errors/BadRequestError');
var RequestTooLargeError = require('../errors/RequestTooLargeError');

/**
 * Represents the sort column value. This value will be used in log, check, get information from request etc.
 */
var SORT_COLUMN = "sortColumn";

/**
 * Represents the default sort column.
 */
var DEFAULT_SORT_COLUMN = "challengeName";

/**
 * Represents a predefined list of valid query parameter for all challenge types.
 */
var ALLOWABLE_QUERY_PARAMETER = [
    "listType", "challengeType", "challengeName", "projectId", SORT_COLUMN,
    "sortOrder", "pageIndex", "pageSize", "prizeLowerBound", "prizeUpperBound", "cmcTaskId"];

/**
 * Represents a predefined list of valid sort column for active challenge.
 */
var ALLOWABLE_SORT_COLUMN = [
    "challengeName", "challengeType", "challengeId", "cmcTaskId", "registrationEndDate",
    "submissionEndDate", "finalFixEndDate", "prize1", "currentStatus", "digitalRunPoints"
];

/**
 * Represents a ListType enum
 */
var ListType = { ACTIVE: "ACTIVE", OPEN: "OPEN", UPCOMING: "UPCOMING", PAST: "PAST" };

/**
 * Represents a predefined list of valid list type.
 */
var ALLOWABLE_LIST_TYPE = [ListType.ACTIVE, ListType.OPEN, ListType.UPCOMING, ListType.PAST];

/**
 * Represents Percentage of Placement Points for digital run
 */
var DR_POINT = [[1], [0.7, 0.3], [0.65, 0.25, 0.10], [0.6, 0.22, 0.1, 0.08], [0.56, 0.2, 0.1, 0.08, 0.06]];

/**
 * Max value for integer
 */
var MAX_INT = 2147483647;

/**
 * The list type and submission phase status map.
 */
var LIST_TYPE_SUBMISSION_STATUS_MAP = {};
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.ACTIVE] = [2, 3];
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.OPEN] = [2];
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.UPCOMING] = [1];
LIST_TYPE_SUBMISSION_STATUS_MAP[ListType.PAST] = [3];

/**
 * The list type and project status map.
 */
var LIST_TYPE_PROJECT_STATUS_MAP = {};
LIST_TYPE_PROJECT_STATUS_MAP[ListType.ACTIVE] = [1];
LIST_TYPE_PROJECT_STATUS_MAP[ListType.OPEN] = [1];
LIST_TYPE_PROJECT_STATUS_MAP[ListType.UPCOMING] = [2];
LIST_TYPE_PROJECT_STATUS_MAP[ListType.PAST] = [4, 5, 6, 7, 8, 9, 10, 11];

/**
 * This copilot posting project type id
 */
var COPILOT_POSTING_PROJECT_TYPE = 29;

/**
 * This method will used to check the query parameter and sort column of the request.
 *
 * @param {Object} helper - the helper.
 * @param {String} type - the challenge type.
 * @param {Object} queryString - the query string object
 * @param {String} sortColumn - the sort column from the request.
 */
function checkQueryParameterAndSortColumn(helper, type, queryString, sortColumn) {
    var allowedQuery = helper.getLowerCaseList(ALLOWABLE_QUERY_PARAMETER),
        allowedSort = helper.getLowerCaseList(ALLOWABLE_SORT_COLUMN),
        currentQuery = helper.getLowerCaseList(Object.keys(queryString)),
        error;
    currentQuery.forEach(function (n) {
        if (allowedQuery.indexOf(n) === -1) {
            error = error ||
                new IllegalArgumentError("The query parameter contains invalid parameter for challenge type '" +
                    type + "'.");
        }
    });
    if (allowedSort.indexOf(sortColumn.toLowerCase()) === -1) {
        error = error || new IllegalArgumentError("The sort column '" + sortColumn +
            "' is invalid for challenge type '" + type + "'.");
    }
    return error;
}


/**
 * This method is used to validate input parameter of the request.
 * @param {Object} helper - the helper.
 * @param {Object} query - the query string.
 * @param {Object} filter - the filter.
 * @param {Number} pageIndex - the page index.
 * @param {Number} pageSize - the page size.
 * @param {String} sortColumn - the sort column.
 * @param {String} sortOrder - the sort order.
 * @param {String} type - the type of challenge.
 * @param {Object} dbConnectionMap - the database connection map.
 * @param {Function<err>} callback - the callback function.
 */
function validateInputParameter(helper, query, filter, pageIndex, pageSize, sortColumn, sortOrder, type, dbConnectionMap, callback) {
    var error = helper.checkContains(['asc', 'desc'], sortOrder.toLowerCase(), "sortOrder") ||
            helper.checkPageIndex(pageIndex, "pageIndex") ||
            helper.checkPositiveInteger(pageSize, "pageSize") ||
            helper.checkMaxNumber(pageSize, MAX_INT, 'pageSize') ||
            helper.checkMaxNumber(pageIndex, MAX_INT, 'pageIndex') ||
            helper.checkContains(ALLOWABLE_LIST_TYPE, type.toUpperCase(), "type") ||
            checkQueryParameterAndSortColumn(helper, type, query, sortColumn);

    if (_.isDefined(filter.projectId)) {
        error = error || helper.checkPositiveInteger(Number(filter.projectId), "projectId");
    }
    if (_.isDefined(filter.prizeLowerBound)) {
        error = error || helper.checkNonNegativeNumber(Number(filter.prizeLowerBound), "prizeLowerBound");
    }
    if (_.isDefined(filter.prizeUpperBound)) {
        error = error || helper.checkNonNegativeNumber(Number(filter.prizeUpperBound), "prizeUpperBound");
    }
    if (error) {
        callback(error);
        return;
    }
    if (_.isDefined(query.challengeType)) {
        helper.isCategoryNameValid(query.challengeType, dbConnectionMap, callback);
    } else {
        callback();
    }
}

/**
 * This method will set up filter for sql query.
 *
 * @param {Object} filter - the filter from http request.
 * @param {Object} sqlParams - the parameters for sql query.
 */
function setFilter(filter, sqlParams) {
    sqlParams.challengeName = "%";
    sqlParams.prilower = 0;
    sqlParams.priupper = MAX_INT;
    sqlParams.tcdirectid = 0;

    if (_.isDefined(filter.challengeType)) {
        sqlParams.categoryName = filter.challengeType.toLowerCase();
    }
    if (_.isDefined(filter.challengeName)) {
        sqlParams.challengeName = "%" + filter.challengeName.toLowerCase() + "%";
    }
    if (_.isDefined(filter.prizeLowerBound)) {
        sqlParams.prilower = filter.prizeLowerBound.toLowerCase();
    }
    if (_.isDefined(filter.prizeUpperBound)) {
        sqlParams.priupper = filter.prizeUpperBound.toLowerCase();
    }
    if (_.isDefined(filter.projectId)) {
        sqlParams.tcdirectid = filter.projectId;
    }
    if (_.isDefined(filter.cmcTaskId)) {
        sqlParams.cmc = filter.cmcTaskId;
    }
}

/**
 * Convert null string or if string is equal to "null"
 * @param {String} str - the string to convert.
 * @return {String} converted string
 */
function convertNull(str) {
    if (!str || str === "null") {
        return "";
    }
    return str;
}


/**
 * Format date
 * @param {Date} date date to format
 * @return {String} formatted date
 */
function formatDate(date) {
    if (!date) {
        return "";
    }
    return date;
}

/**
 * This method will get data from the query result.
 *
 * @param {Array} src - the query result.
 * @param {Object} helper - the helper object.
 * @return {Array} a list of transferred challenges
 */
function transferResult(src, helper) {
    var ret = [];
    src.forEach(function (row) {
        var challenge = {
            challengeType : row.challenge_type,
            challengeName : row.challenge_name,
            challengeId : row.challenge_id,
            projectId : row.project_id,
            forumId : row.forum_id,
            numSubmissions : row.num_submissions,
            numRegistrants : row.num_registrants,
            screeningScorecardId : row.screening_scorecard_id,
            reviewScorecardId : row.review_scorecard_id,
            cmcTaskId : convertNull(row.cmc_task_id),
            numberOfCheckpointsPrizes : row.number_of_checkpoints_prizes,
            topCheckPointPrize : convertNull(row.top_checkpoint_prize),
            postingDate : formatDate(row.posting_date),
            registrationEndDate : formatDate(row.registration_end_date),
            checkpointSubmissionEndDate : formatDate(row.checkpoint_submission_end_date),
            submissionEndDate : formatDate(row.submission_end_date),
            appealsEndDate : formatDate(row.appeals_end_date),
            finalFixEndDate : formatDate(row.final_fix_end_date),
            currentPhaseEndDate : formatDate(row.current_phase_end_date),
            currentPhaseRemainingTime : row.current_phase_remaining_time,
            currentStatus : row.current_status,
            currentPhaseName : convertNull(row.current_phase_name),
            digitalRunPoints: row.digital_run_points,
            prize: [],
            reliabilityBonus: helper.getReliabilityBonus(row.prize1),
            challengeCommunity: row.is_studio ? 'design' : 'develop'
        },
            i,
            prize;
        for (i = 1; i < 10; i = i + 1) {
            prize = row["prize" + i];
            if (prize && prize !== -1) {
                challenge.prize.push(prize);
            }
        }
        ret.push(challenge);
    });
    return ret;
}


/**
 * This is the function that actually search challenges
 *
 * @param {Object} api - The api object that is used to access the global infrastructure
 * @param {Object} connection - The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {String} community - The community string that represent which challenge to search.
 * @param {Function<connection, render>} next - The callback to be called after this function is done
 */
var searchChallenges = function (api, connection, dbConnectionMap, community, next) {
    var helper = api.helper,
        query = connection.rawConnection.parsedURL.query,
        copyToFilter = ["challengeType", "challengeName", "projectId", "prizeLowerBound",
            "prizeUpperBound", "cmcTaskId"],
        sqlParams = {},
        filter = {},
        pageIndex,
        pageSize,
        sortColumn,
        sortOrder,
        listType,
        prop,
        result = {},
        total,
        challengeType;
    for (prop in query) {
        if (query.hasOwnProperty(prop)) {
            query[prop.toLowerCase()] = query[prop];
        }
    }

    switch (community) {
    case helper.studio.community:
        challengeType = helper.studio;
        break;
    case helper.software.community:
        challengeType = helper.software;
        break;
    case helper.both.community:
        challengeType = helper.both;
        break;
    }

    sortOrder = query.sortorder || "asc";
    sortColumn = query.sortcolumn || DEFAULT_SORT_COLUMN;
    listType = (query.listtype || ListType.OPEN).toUpperCase();
    pageIndex = Number(query.pageindex || 1);
    pageSize = Number(query.pagesize || 50);

    copyToFilter.forEach(function (p) {
        if (query.hasOwnProperty(p.toLowerCase())) {
            filter[p] = query[p.toLowerCase()];
        }
    });

    async.waterfall([
        function (cb) {
            validateInputParameter(helper, query, filter, pageIndex, pageSize, sortColumn, sortOrder, listType, dbConnectionMap, cb);
        }, function (cb) {
            if (pageIndex === -1) {
                pageIndex = 1;
                pageSize = MAX_INT;
            }

            setFilter(filter, sqlParams);
            sqlParams.firstRowIndex = (pageIndex - 1) * pageSize;
            sqlParams.pageSize = pageSize;
            sqlParams.sortColumn = sortColumn.toLowerCase();
            sqlParams.sortColumn = helper.getSortColumnDBName(sortColumn.toLowerCase());
            sqlParams.sortOrder = sortOrder.toLowerCase();
            // Set the project type id
            sqlParams.project_type_id = challengeType.category;
            // Set the submission phase status id.
            sqlParams.submission_phase_status = LIST_TYPE_SUBMISSION_STATUS_MAP[listType];
            sqlParams.project_status_id = LIST_TYPE_PROJECT_STATUS_MAP[listType];
            api.dataAccess.executeQuery('search_software_studio_challenges_count', sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            total = rows[0].total;
            api.dataAccess.executeQuery('search_software_studio_challenges', sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            if (rows.length === 0) {
                result.data = [];
                result.total = total;
                result.pageIndex = pageIndex;
                result.pageSize = pageIndex === -1 ? total : pageSize;
                cb();
                return;
            }
            result.data = transferResult(rows, helper);
            result.total = total;
            result.pageIndex = pageIndex;
            result.pageSize = pageIndex === -1 ? total : pageSize;
            cb();
        }
    ], function (err) {
        if (err) {
            helper.handleError(api, connection, err);
        } else {
            connection.response = result;
        }
        next(connection, true);
    });
};

/**
 * This is the function that gets challenge details
 * 
 * @param {Object} api - The api object that is used to access the global infrastructure
 * @param {Object} connection - The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {Boolean} isStudio - the flag that represent if to search studio challenges.
 * @param {Function<connection, render>} next - The callback to be called after this function is done
 */
var getChallenge = function (api, connection, dbConnectionMap, isStudio, next) {
    var challenge, error, helper = api.helper, sqlParams, challengeType = isStudio ? helper.studio : helper.software,
        caller = connection.caller;
    async.waterfall([
        function (cb) {
            error = helper.checkPositiveInteger(Number(connection.params.contestId), 'contestId') ||
                helper.checkMaxNumber(Number(connection.params.contestId), MAX_INT, 'contestId');
            if (error) {
                cb(error);
                return;
            }
            sqlParams = {
                challengeId: connection.params.contestId,
                project_type_id: challengeType.category,
                user_id: caller.userId || 0
            };

            // Do the private check.
            api.dataAccess.executeQuery('check_user_challenge_accessibility', sqlParams, dbConnectionMap, cb);
        }, function (result, cb) {
            if (result[0].is_private && !result[0].has_access) {
                cb(new UnauthorizedError('The user is not allowed to visit the challenge.'));
                return;
            }

            var execQuery = function (name) {
                return function (cbx) {
                    api.dataAccess.executeQuery(name, sqlParams, dbConnectionMap, cbx);
                };
            };
            if (isStudio) {
                async.parallel({
                    details: execQuery('challenge_details'),
                    checkpoints: execQuery("get_studio_challenge_detail_checkpoints"),
                    submissions: execQuery("get_studio_challenge_detail_submissions"),
                    winners: execQuery("get_studio_challenge_detail_winners"),
                    platforms: execQuery('challenge_platforms'),
                    phases: execQuery('challenge_phases'),
                    documents: execQuery('challenge_documents')
                }, cb);
            } else {
                async.parallel({
                    details: execQuery('challenge_details'),
                    registrants: execQuery('challenge_registrants'),
                    submissions: execQuery('challenge_submissions'),
                    platforms: execQuery('challenge_platforms'),
                    phases: execQuery('challenge_phases'),
                    documents: execQuery('challenge_documents')
                }, cb);
            }
        }, function (results, cb) {
            if (results.details.length === 0) {
                cb(new NotFoundError('Challenge not found.'));
                return;
            }
            var data = results.details[0], i = 0, prize = 0,
                mapSubmissions = function (results) {
                    var submissions = [], passedReview = 0, drTable, submission = {};
                    if (isStudio) {
                        submissions = _.map(results.submissions, function (item) {
                            return {
                                submissionId: item.submission_id,
                                submitter: item.handle,
                                submissionTime: formatDate(item.create_date)
                            };
                        });
                    } else {
                        results.submissions.forEach(function (item) {
                            if (item.placement) {
                                passedReview = passedReview + 1;
                            }
                        });
                        drTable = DR_POINT[Math.min(passedReview - 1, 4)];
                        submissions = _.map(results.submissions, function (item) {
                            submission = {
                                handle: item.handle,
                                placement: item.placement || "",
                                screeningScore: item.screening_score,
                                initialScore: item.initial_score,
                                finalScore: item.final_score,
                                points: 0,
                                submissionStatus: item.submission_status,
                                submissionDate: formatDate(item.submission_date)
                            };
                            if (submission.placement && drTable.length >= submission.placement) {
                                submission.points = drTable[submission.placement - 1] * results.details[0].digital_run_points;
                            }
                            return submission;
                        });
                    }
                    return submissions;
                },
                mapPlatforms = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    var platforms = [];
                    results.forEach(function (item) {
                        platforms.push(item.name);
                    });
                    return platforms;
                },
                mapPhases = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (item) {
                        return {
                            type: item.type,
                            status: item.status,
                            scheduledStartTime: item.scheduled_start_time,
                            actualStartTime: item.actual_start_time,
                            scheduledEndTime: item.scheduled_end_time,
                            actualendTime: item.actual_end_time
                        };
                    });
                },
                mapRegistrants = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (item) {
                        return {
                            handle: item.handle,
                            reliability: !_.isDefined(item.reliability) ? "n/a" : item.reliability + "%",
                            registrationDate: formatDate(item.inquiry_date)
                        };
                    });
                },
                mapPrize = function (results) {
                    var prizes = [];
                    for (i = 1; i < 10; i = i + 1) {
                        prize = results["prize" + i];
                        if (prize && prize !== -1) {
                            prizes.push(prize);
                        }
                    }
                    return prizes;
                },
                mapWinners = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (s) {
                        return {
                            submissionId: s.submission_id,
                            submitter: s.submitter,
                            submissionTime: s.submission_time,
                            points: s.points,
                            rank: s.rank
                        };
                    });
                },
                mapCheckPoints = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (s) {
                        return {
                            submissionId: s.submission_id,
                            submitter: s.handle,
                            submissionTime: s.create_date
                        };
                    });
                },
                mapDocuments = function (results) {
                    if (!_.isDefined(results)) {
                        return [];
                    }
                    return _.map(results, function (item) {
                        return {
                            documentName: item.document_name,
                            url: api.configData.documentProvider + '=' + item.document_id
                        };
                    });
                };
            challenge = {
                challengeType : data.challenge_type,
                challengeName : data.challenge_name,
                challengeId : data.challenge_id,
                projectId : data.project_id,
                forumId : data.forum_id,
                introduction: data.introduction,
                detailedRequirements : isStudio ? data.studio_detailed_requirements : data.software_detailed_requirements,
                finalSubmissionGuidelines : data.final_submission_guidelines,
                screeningScorecardId : data.screening_scorecard_id,
                reviewScorecardId : data.review_scorecard_id,
                cmcTaskId : convertNull(data.cmc_task_id),
                numberOfCheckpointsPrizes : data.number_of_checkpoints_prizes,
                topCheckPointPrize : convertNull(data.top_checkpoint_prize),
                postingDate : formatDate(data.posting_date),
                registrationEndDate : formatDate(data.registration_end_date),
                checkpointSubmissionEndDate : formatDate(data.checkpoint_submission_end_date),
                submissionEndDate : formatDate(data.submission_end_date),
                appealsEndDate : formatDate(data.appeals_end_date),
                finalFixEndDate : formatDate(data.final_fix_end_date),
                currentPhaseEndDate : formatDate(data.current_phase_end_date),
                currentStatus : data.current_status,
                currentPhaseName : convertNull(data.current_phase_name),
                currentPhaseRemainingTime : data.current_phase_remaining_time,
                digitalRunPoints: data.digital_run_points,
                reliabilityBonus: helper.getReliabilityBonus(data.prize1),
                challengeCommunity: challengeType.community,
                directUrl : helper.getDirectProjectLink(data.challenge_id),

                technology: data.technology.split(', '),
                prize: mapPrize(data),
                registrants: mapRegistrants(results.registrants),
                checkpoints: mapCheckPoints(results.checkpoints),
                submissions: mapSubmissions(results),
                winners: mapWinners(results.winners),
                Documents: mapDocuments(results.documents)
            };

            if (isStudio) {
                delete challenge.registrants;
                delete challenge.finalSubmissionGuidelines;
                delete challenge.reliabilityBonus;
                delete challenge.technology;
                delete challenge.platforms;
            } else {
                challenge.numberOfSubmissions = results.submissions.length;
                challenge.numberOfRegistrants = results.registrants.length;

                if (data.is_reliability_bonus_eligible !== 'true') {
                    delete challenge.reliabilityBonus;
                }
                delete challenge.checkpoints;
                delete challenge.winners;
                delete challenge.introduction;
            }
            challenge.platforms = mapPlatforms(results.platforms);
            challenge.phases = mapPhases(results.phases);
            cb();
        }
    ], function (err) {
        if (err) {
            helper.handleError(api, connection, err);
        } else {
            connection.response = challenge;
        }
        next(connection, true);
    });
};

/**
 * Gets the challenge terms for the current user given the challenge id and an optional role.
 * 
 * @param {Object} api The api object that is used to access the global infrastructure
 * @param {Object} connection The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {Function<connection, render>} next The callback to be called after this function is done
 * @since 1.7
 */
var getChallengeTerms = function (api, connection, dbConnectionMap, next) {

    //Check if the user is logged-in
    if (_.isUndefined(connection.caller) || _.isNull(connection.caller) ||
            _.isEmpty(connection.caller) || !_.contains(_.keys(connection.caller), 'userId')) {
        api.helper.handleError(api, connection, new UnauthorizedError("Authentication details missing or incorrect."));
        next(connection, true);
        return;
    }

    var helper = api.helper,
        sqlParams = {},
        result = {},
        userId = connection.caller.userId,
        challengeId = Number(connection.params.challengeId),
        role = connection.params.role;

    async.waterfall([
        function (cb) {

            //Simple validations of the incoming parameters
            var error = helper.checkPositiveInteger(challengeId, 'challengeId') ||
                helper.checkMaxNumber(challengeId, MAX_INT, 'challengeId');

            if (error) {
                cb(error);
                return;
            }

            //Check if the user passes validations for joining the challenge
            sqlParams.userId = userId;
            sqlParams.challengeId = challengeId;

            api.dataAccess.executeQuery("challenge_registration_validations", sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            if (rows.length === 0) {
                cb(new NotFoundError('No such challenge exists.'));
                return;
            }

            if (!rows[0].no_elgibility_req && !rows[0].user_in_eligible_group) {
                cb(new ForbiddenError('You are not part of the groups eligible for this challenge.'));
                return;
            }

            if (!rows[0].reg_open) {
                cb(new ForbiddenError('Registration Phase of this challenge is not open.'));
                return;
            }

            if (rows[0].user_registered) {
                cb(new ForbiddenError('You are already registered for this challenge.'));
                return;
            }

            if (rows[0].user_suspended) {
                cb(new ForbiddenError('You cannot participate in this challenge due to suspension.'));
                return;
            }

            if (rows[0].user_country_missing_or_banned) {
                cb(new ForbiddenError('You cannot participate in this challenge as your country information is either missing or is banned.'));
                return;
            }

            if (rows[0].project_category_id === COPILOT_POSTING_PROJECT_TYPE) {
                if (!rows[0].user_is_copilot && rows[0].copilot_type.indexOf("Marathon Match") < 0) {
                    cb(new ForbiddenError('You cannot participate in this challenge because you are not an active member of the copilot pool.'));
                    return;
                }
            }

            // We are here. So all validations have passed.
            // Next we get all roles
            api.dataAccess.executeQuery("all_resource_roles", {}, dbConnectionMap, cb);
        }, function (rows, cb) {
            // Prepare a comma separated string of resource role names that must match
            var commaSepRoleIds = "",
                compiled = _.template("<%= resource_role_id %>,"),
                ctr = 0,
                resourceRoleFound;
            if (_.isUndefined(role)) {
                rows.forEach(function (row) {
                    commaSepRoleIds += compiled({resource_role_id: row.resource_role_id});
                    ctr += 1;
                    if (ctr === rows.length) {
                        commaSepRoleIds = commaSepRoleIds.slice(0, -1);
                    }
                });
            } else {
                resourceRoleFound = _.find(rows, function (row) {
                    return (row.name === role);
                });
                if (_.isUndefined(resourceRoleFound)) {
                    //The role passed in is not recognized
                    cb(new BadRequestError("The role: " + role + " was not found."));
                    return;
                }
                commaSepRoleIds = resourceRoleFound.resource_role_id;
            }

            // Get the terms
            sqlParams.resourceRoleIds = commaSepRoleIds;
            api.dataAccess.executeQuery("challenge_terms_of_use", sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            //We could just have down result.data = rows; but we need to change keys to camel case as per requirements
            var camelCaseMap = {
                'agreeability_type': 'agreeabilityType',
                'terms_of_use_id': 'termsOfUseId'
            };
            result.terms = [];
            _.each(rows, function (row) {
                var item = {};
                _.each(row, function (value, key) {
                    key = camelCaseMap[key] || key;
                    item[key] = value;
                });
                result.terms.push(item);
            });
            cb();
        }
    ], function (err) {
        if (err) {
            helper.handleError(api, connection, err);
        } else {
            connection.response = result;
        }
        next(connection, true);
    });
};

/**
 * Gets the term details given the term id. 
 * 
 * @param {Object} api The api object that is used to access the global infrastructure
 * @param {Object} connection The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {Function<connection, render>} next The callback to be called after this function is done
 * @since 1.7
 */
var getTermsOfUse = function (api, connection, dbConnectionMap, next) {

    //Check if the user is logged-in
    if (_.isUndefined(connection.caller) || _.isNull(connection.caller) ||
            _.isEmpty(connection.caller) || !_.contains(_.keys(connection.caller), 'userId')) {
        api.helper.handleError(api, connection, new UnauthorizedError("Authentication details missing or incorrect."));
        next(connection, true);
        return;
    }

    var helper = api.helper,
        sqlParams = {},
        result = {},
        termsOfUseId = Number(connection.params.termsOfUseId);

    async.waterfall([
        function (cb) {

            //Simple validations of the incoming parameters
            var error = helper.checkPositiveInteger(termsOfUseId, 'termsOfUseId') ||
                helper.checkMaxNumber(termsOfUseId, MAX_INT, 'termsOfUseId');
            if (error) {
                cb(error);
                return;
            }

            sqlParams.termsOfUseId = termsOfUseId;
            api.dataAccess.executeQuery("get_terms_of_use", sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            if (rows.length === 0) {
                cb(new NotFoundError('No such terms of use exists.'));
                return;
            }

            //We could just have result = rows[0]; but we need to change keys to camel case as per requirements
            var camelCaseMap = {
                'agreeability_type': 'agreeabilityType',
                'terms_of_use_id': 'termsOfUseId'
            };
            _.each(rows[0], function (value, key) {
                key = camelCaseMap[key] || key;
                result[key] = value;
            });

            cb();
        }
    ], function (err) {
        if (err) {
            helper.handleError(api, connection, err);
        } else {
            connection.response = result;
        }
        next(connection, true);
    });
};

/**
 * This is the function that handles user's submission for a develop challenge.
 * It handles both checkpoint and final submissions
 * @since 1.9 
 *
 * @param {Object} api - The api object that is used to access the global infrastructure
 * @param {Object} connection - The connection object for the current request
 * @param {Object} dbConnectionMap The database connection map for the current request
 * @param {Function<connection, render>} next - The callback to be called after this function is done
 */
var submitForDevelopChallenge = function (api, connection, dbConnectionMap, next) {
    var helper = api.helper,
        sqlParams = {},
        ret = {},
        userId = connection.caller.userId,
        challengeId = Number(connection.params.challengeId),
        fileName = connection.params.fileName,
        fileData = connection.params.fileData,
        type = connection.params.type,
        error,
        resourceId,
        userEmail,
        userHandle,
        submissionPhaseId,
        checkpointSubmissionPhaseId,
        uploadId,
        submissionId,
        thurgoodLanguage,
        thurgoodPlatform,
        thurgoodApiKey = process.env.THURGOOD_API_KEY || api.configData.thurgoodApiKey,
        thurgoodJobId = null,
        multipleSubmissionPossible,
        savedFilePath = null;

    async.waterfall([
        function (cb) {
            //Check if the user is logged-in
            if (_.isUndefined(connection.caller) || _.isNull(connection.caller) ||
                    _.isEmpty(connection.caller) || !_.contains(_.keys(connection.caller), 'userId')) {
                cb(new UnauthorizedError("Authentication details missing or incorrect."));
                return;
            }

            //Simple validations of the incoming parameters
            error = helper.checkPositiveInteger(challengeId, 'challengeId') ||
                helper.checkMaxNumber(challengeId, MAX_INT, 'challengeId') ||
                helper.checkStringPopulated(fileName, 'fileName') ||
                helper.checkStringPopulated(fileData, 'fileData');

            if (error) {
                cb(error);
                return;
            }

            //Validation for the type parameter
            if (_.isNull(type) || _.isUndefined(type)) {
                type = 'final';
            } else {
                type = type.toLowerCase();
                if (type !== 'final' && type !== 'checkpoint') {
                    cb(new BadRequestError("type can either be final or checkpoint."));
                    return;
                }
            }

            //Validation for the size of the fileName parameter. It should be 256 chars as this is max length of parameter field in submission table.
            if (fileName.length > 256) {
                cb(new BadRequestError("The file name is too long. It must be 256 characters or less."));
                return;
            }

            //All basic validations now pass.
            //Check if the backend validations for submitting to the challenge are passed
            sqlParams.userId = userId;
            sqlParams.challengeId = challengeId;

            api.dataAccess.executeQuery("challenge_submission_validations_and_info", sqlParams, dbConnectionMap, cb);
        }, function (rows, cb) {
            if (rows.length === 0) {
                cb(new NotFoundError('No such challenge exists.'));
                return;
            }

            if (!rows[0].is_develop_challenge) {
                cb(new BadRequestError('Non-develop challenges are not supported.'));
                return;
            }

            if (!rows[0].is_submission_open && type === 'final') {
                cb(new BadRequestError('Submission phase for this challenge is not open.'));
                return;
            }

            if (!rows[0].is_checkpoint_submission_open && type === 'checkpoint') {
                cb(new BadRequestError('Checkpoint submission phase for this challenge is not open.'));
                return;
            }

            if (_.contains([27, 29], rows[0].project_category_id)) {
                cb(new BadRequestError('Submission to Marathon Matches and Spec Reviews are not supported.'));
                return;
            }

            //Note 1 - this will also cover the case where user is not registered, 
            //as the corresponding resource with role = Submitter will be absent in DB.
            //Note 2 - this will also cover the case of private challenges
            //User will have role Submitter only if the user belongs to group of private challenge and is registered.
            if (!rows[0].is_user_submitter_for_challenge) {
                cb(new ForbiddenError('You cannot submit for this challenge as you are not a Submitter.'));
                return;
            }

            resourceId = rows[0].resource_id;
            submissionPhaseId = rows[0].submission_phase_id;
            checkpointSubmissionPhaseId = rows[0].checkpoint_submission_phase_id;
            thurgoodPlatform = rows[0].thurgood_platform;
            thurgoodLanguage = rows[0].thurgood_language;
            userHandle = rows[0].user_handle;
            userEmail = rows[0].user_email;
            multipleSubmissionPossible = rows[0].multiple_submissions_possible;

            //All validations are now complete. Generate the new ids for the upload and submission
            async.parallel({
                submissionId: function (cb) {
                    api.idGenerator.getNextID("SUBMISSION_SEQ", dbConnectionMap, cb);
                },
                uploadId: function (cb) {
                    api.idGenerator.getNextID("UPLOAD_SEQ", dbConnectionMap, cb);
                }
            }, cb);
        }, function (generatedIds, cb) {
            uploadId = generatedIds.uploadId;
            submissionId = generatedIds.submissionId;

            var submissionPath,
                filePathToSave,
                decodedFileData;

            //The file output dir should be overwritable by environment variable
            submissionPath = process.env.DEV_UPLOAD_SUBMISSION_DIR || api.configData.devUploadSubmissionDir;

            //The path to save is the folder with the name as <base submission path>
            //The name of the file is the <generated upload id>_<original file name>
            filePathToSave = submissionPath + "/" + uploadId + "_" + connection.params.fileName;

            //Decode the base64 encoded file data
            decodedFileData = new Buffer(connection.params.fileData, 'base64');

            //Write the submission to file
            fs.writeFile(filePathToSave, decodedFileData, function (err) {
                if (err) {
                    cb(err);
                    return;
                }

                //Check the max length of the submission file (if there is a limit)
                if (api.configData.submissionMaxSizeBytes > 0) {
                    fs.stat(filePathToSave, function (err, stats) {
                        if (err) {
                            cb(err);
                            return;
                        }
                        if (stats.size > api.configData.submissionMaxSizeBytes) {
                            cb(new RequestTooLargeError(
                                "The submission file size is greater than the max allowed size: " + (api.configData.submissionMaxSizeBytes / 1024) + " KB."
                            ));
                            return;
                        }
                        savedFilePath = filePathToSave;
                        cb();
                    });
                } else {
                    savedFilePath = filePathToSave;
                    cb();
                }
            });
        }, function (cb) {
            //Now insert into upload table
            _.extend(sqlParams, {
                uploadId: uploadId,
                userId: userId,
                challengeId: challengeId,
                projectPhaseId: type === 'final' ? submissionPhaseId : checkpointSubmissionPhaseId,
                resourceId: resourceId,
                fileName: fileName,
            });
            api.dataAccess.executeQuery("insert_upload", sqlParams, dbConnectionMap, cb);
        }, function (notUsed, cb) {
            //Now check if the contest is a CloudSpokes one and if it needs to submit the thurgood job
            if (!_.isUndefined(thurgoodPlatform) && !_.isUndefined(thurgoodLanguage) && type === 'final') {
                //Make request to the thurgood job api url

                //Prepare the options for the request
                var options = {
                    url: api.configData.thurgoodApiUrl,
                    timeout: api.configData.thurgoodTimeout,
                    method: 'POST',
                    headers: {
                        'Authorization': 'Token: token=' + thurgoodApiKey
                    },
                    form: {
                        'email': userEmail,
                        'thurgoodLanguage': thurgoodLanguage,
                        'userId': userHandle,
                        'notification': 'email',
                        'codeUrl': api.configData.thurgoodCodeUrl + uploadId,
                        'platform': thurgoodPlatform
                    }
                };

                //Make the actual request
                request(options, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        var respJson = JSON.parse(body);
                        if (_.has(respJson, 'success') && respJson.success.toLowerCase() === 'true'
                                && _.has(respJson, 'data') && _.has(respJson.data, '_id') && String(respJson.data._id) !== '') {
                            thurgoodJobId = String(respJson.data._id);
                        }
                    }
                    //Even if the request fails, we don't mind. This follows from the strategy used in current code.
                    //In case of error, thurgoodJobId will just be null and the next call will not be made.
                    cb();
                });
            } else {
                cb();
            }
        }, function (cb) {
            //If we created a thurgood job id, then we now submit it.
            if (!_.isNull(thurgoodJobId)) {
                //Make request to the submit thurgood job id api url

                //Prepare the options for the request
                var options = {
                    url: api.configData.thurgoodApiUrl + '/' + thurgoodJobId + '/submit',
                    timeout: api.configData.thurgoodTimeout,
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Token: token=' + thurgoodApiKey
                    }
                };

                //Make the actual request
                request(options, function () {
                    //Even if the request fails, we don't mind. This follows from the strategy used in current code.
                    //Although this seems counter-intuitive, this is how it is implemented currently in code, and so we stick with it.
                    cb();
                });
            } else {
                cb();
            }
        }, function (cb) {
            //Now we are ready to 
            //1) Insert into submission table 
            //2) Insert into resource_submission table
            //3) Possibly delete older submissions and uploads by the user, if multiple submissions are not allowed
            _.extend(sqlParams, {
                submissionId: submissionId,
                thurgoodJobId: thurgoodJobId,
                submissionTypeId: type === 'final' ? 1 : 3
            });

            async.series([
                function (cb) {
                    api.dataAccess.executeQuery("insert_submission", sqlParams, dbConnectionMap, function (err, result) {
                        cb(err, result);
                    });
                }, function (cb) {
                    api.dataAccess.executeQuery("insert_resource_submission", sqlParams, dbConnectionMap, function (err, result) {
                        cb(err, result);
                    });
                }, function (cb) {
                    if (!multipleSubmissionPossible) {
                        api.dataAccess.executeQuery("delete_old_submissions", sqlParams, dbConnectionMap, function (err, result) {
                            cb(err, result);
                        });
                    } else {
                        cb();
                    }
                }, function (cb) {
                    if (!multipleSubmissionPossible) {
                        api.dataAccess.executeQuery("delete_old_uploads", sqlParams, dbConnectionMap, function (err, result) {
                            cb(err, result);
                        });
                    } else {
                        cb();
                    }
                }
            ], cb);
        }
    ], function (err) {
        if (err) {
            //If file has been written before error, delete it
            if (!_.isNull(savedFilePath)) {
                //If we are unable to delete, we cannot do anything
                fs.unlink(savedFilePath, null);
            }
            helper.handleError(api, connection, err);
        } else {
            ret = {
                submissionId: submissionId,
                uploadId: uploadId
            };
            connection.response = ret;
        }
        next(connection, true);
    });
};


/**
 * The API for getting challenge terms of use
 */
exports.getChallengeTerms = {
    name: "getChallengeTerms",
    description: "getChallengeTerms",
    inputs: {
        required: ["challengeId"],
        optional: ["role"]
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog", "common_oltp"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute getChallengeTerms#run", 'debug');
            getChallengeTerms(api, connection, connection.dbConnectionMap, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for getting terms of use by id
 */
exports.getTermsOfUse = {
    name: "getTermsOfUse",
    description: "getTermsOfUse",
    inputs: {
        required: ["termsOfUseId"],
        optional: []
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["common_oltp"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute getTermsOfUse#run", 'debug');
            getTermsOfUse(api, connection, connection.dbConnectionMap, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};


/**
 * The API for getting challenge
 */
exports.getSoftwareChallenge = {
    name: "getSoftwareChallenge",
    description: "getSoftwareChallenge",
    inputs: {
        required: ["contestId"],
        optional: []
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute getChallenge#run", 'debug');
            getChallenge(api, connection, connection.dbConnectionMap, false, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for getting studio challenge
 */
exports.getStudioChallenge = {
    name: "getStudioChallenge",
    description: "getStudioChallenge",
    inputs: {
        required: ["contestId"],
        optional: []
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction: 'read', // this action is read-only
    databases: ["tcs_catalog", "tcs_dw"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute getStudioChallenge#run", 'debug');
            getChallenge(api, connection, connection.dbConnectionMap, true, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for searching challenges
 */
exports.searchSoftwareChallenges = {
    name: "searchSoftwareChallenges",
    description: "searchSoftwareChallenges",
    inputs: {
        required: [],
        optional: ALLOWABLE_QUERY_PARAMETER
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute searchSoftwareChallenges#run", 'debug');
            searchChallenges(api, connection, connection.dbConnectionMap, 'develop', next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for searching challenges
 */
exports.searchStudioChallenges = {
    name: "searchStudioChallenges",
    description: "searchStudioChallenges",
    inputs: {
        required: [],
        optional: ALLOWABLE_QUERY_PARAMETER
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute searchStudioChallenges#run", 'debug');
            searchChallenges(api, connection, connection.dbConnectionMap, 'design', next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * Generic API for searching challenges
 */
exports.searchSoftwareAndStudioChallenges = {
    name: "searchSoftwareAndStudioChallenges",
    description: "searchSoftwareAndStudioChallenges",
    inputs: {
        required: [],
        optional: ALLOWABLE_QUERY_PARAMETER
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction : 'read', // this action is read-only
    databases : ["tcs_catalog"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute searchSoftwareAndStudioChallenges#run", 'debug');
            searchChallenges(api, connection, connection.dbConnectionMap, 'both', next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};

/**
 * The API for posting submission to software challenge
 * @since 1.9
 */
exports.submitForDevelopChallenge = {
    name: "submitForDevelopChallenge",
    description: "submitForDevelopChallenge",
    inputs: {
        required: ["challengeId", "fileName", "fileData"],
        optional: ["type"]
    },
    blockedConnectionTypes: [],
    outputExample: {},
    version: 'v2',
    transaction: 'write',
    cacheEnabled : false,
    databases: ["tcs_catalog", "common_oltp"],
    run: function (api, connection, next) {
        if (connection.dbConnectionMap) {
            api.log("Execute submitForDevelopChallenge#run", 'debug');
            submitForDevelopChallenge(api, connection, connection.dbConnectionMap, next);
        } else {
            api.helper.handleNoConnection(api, connection, next);
        }
    }
};
