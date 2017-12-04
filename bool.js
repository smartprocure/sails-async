var _ = require('lodash')
var Promise = require('bluebird')

// Based on http://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
var objectifyError = function (err) {
  var plainObject = {}
  Object.getOwnPropertyNames(err).forEach(function (key) {
    plainObject[key] = err[key]
  })
  return plainObject
}

var FailResponse = function fail (data, extra) {
  data = _.isString(data) ? { message: data } : data
  extra = _.isString(extra) ? { message: extra } : extra
  extra = _.isNumber(extra) ? { statusCode: extra } : extra

  data = data.stack ? objectifyError(data) : data
  this.req._sails.log.error(data)

    // Stop Mongoose Models from doing weird stuff preventing status from going
  if (data.toObject) { data = data.toObject({ minimize: false }) }

  var response = _.extend({ status: 'error' }, data, extra)
  var statusCode = response.statusCode || 500

  this.res.json(statusCode, response)
}

var or = function (a, b) {
  return a || b
}
var and = function (a, b) {
  return a && b
}

module.exports = _.extend(function (combinator, policies) {
  return function (req, res, next) {
    var passed = combinator === and

    Promise.map(policies, function (policy) {
      var result

      var mock = {
        send: function (status, body) {
          result = {
            body: body || status,
            status: body ? status : null
          }
        },
        fail: FailResponse.bind({
          req: _.set({}, '_sails.log.error', _.noop),
          res: {
            json: function (statusCode, response) {
              result = {
                body: response,
                status: statusCode
              }
            }
          }
        }),
        set: _.noop,
        status: () => mock
      }

      var policyResponse = policy(req, mock, function () {
        passed = combinator(passed, true)
      })

      return Promise.resolve(policyResponse).then(function () {
        return result
      })
    }).then(function (results) {
      if (passed) { next() } else { res.status(401).send(_.map(results, 'body')) }
    })
  }
}, {
  or: or,
  and: and
})
