let AbstractStorage = artifacts.require('./AbstractStorage')
let ScriptExec = artifacts.require('./RegistryExec')
let ScriptExecMock = artifacts.require('./RegistryExecMock')
// Registry
let RegistryUtil = artifacts.require('./RegistryUtil')
let RegistryIdx = artifacts.require('./RegistryIdx')
let Provider = artifacts.require('./Provider')
// Mock
let AppInitMock = artifacts.require('./mock/AppInitMock')
let PayableApp = artifacts.require('./mock/PayableApp')
let StdApp = artifacts.require('./mock/StdApp')
let EmitsApp = artifacts.require('./mock/EmitsApp')
let MixedApp = artifacts.require('./mock/MixedApp')
let InvalidApp = artifacts.require('./mock/InvalidApp')
let RevertApp = artifacts.require('./mock/RevertApp')
// Util
let TestUtils = artifacts.require('./util/TestUtils')
let AppInitUtil = artifacts.require('./util/AppInitUtil')
let AppMockUtil = artifacts.require('./util/AppMockUtil')
let Utils = require('./support/utils.js')

function getTime() {
  let block = web3.eth.getBlock('latest')
  return block.timestamp;
}

function zeroAddress() {
  return web3.toHex(0)
}

function hexStrEquals(hex, expected) {
  return web3.toAscii(hex).substring(0, expected.length) == expected;
}

contract('RegistryExec', function (accounts) {

  let storage
  let scriptExec

  let execAdmin = accounts[0]
  let updater = accounts[1]
  let provider = accounts[2]
  let registryExecID
  let testUtils

  let sender = accounts[3]

  let execHash = web3.sha3('ApplicationExecution(bytes32,address)')
  let payHash = web3.sha3('DeliveredPayment(bytes32,address,uint256)')
  // PayableApp
  let payees = [accounts[5], accounts[6]]
  let payouts = [444, 222]
  // StdApp
  let storageLocations = [web3.toHex('AA'), web3.toHex('BB')]
  let storageValues = ['CC', 'DD']
  // EmitsApp
  let registryHash = web3.sha3('RegistryInstanceCreated(address,bytes32,address,address)')
  let emitTopics = ['aaaaa', 'bbbbbb', 'ccccc', 'ddddd']

  let appInit
  let appInitUtil

  let initCalldata

  let appMockUtil
  let payableApp
  let stdApp
  let emitApp
  let mixApp
  let invalidApp
  let revertApp

  let stdAppName = 'stdapp'
  let stdAppName2 = 'stdapp2'
  let version1 = '0.0.1'
  let appSelectors
  let allowedAddrs

  let stdAppCalldata

  let regExecID
  let regUtil
  let regProvider
  let regIdx

  before(async () => {
    storage = await AbstractStorage.new().should.be.fulfilled

    regUtil = await RegistryUtil.new().should.be.fulfilled
    regProvider = await Provider.new().should.be.fulfilled
    regIdx = await RegistryIdx.new().should.be.fulfilled

    appInit = await AppInitMock.new().should.be.fulfilled
    appInitUtil = await AppInitUtil.new().should.be.fulfilled
    testUtils = await TestUtils.new().should.be.fulfilled

    appMockUtil = await AppMockUtil.new().should.be.fulfilled
    payableApp = await PayableApp.new().should.be.fulfilled
    stdApp = await StdApp.new().should.be.fulfilled
    emitApp = await EmitsApp.new().should.be.fulfilled
    mixApp = await MixedApp.new().should.be.fulfilled
    invalidApp = await InvalidApp.new().should.be.fulfilled
    revertApp = await RevertApp.new().should.be.fulfilled

    initCalldata = await appInitUtil.init.call().should.be.fulfilled
    initCalldata.should.not.eq('0x0')

    appSelectors = await appMockUtil.getSelectors.call().should.be.fulfilled
    appSelectors.length.should.be.eq(27)

    allowedAddrs = [
      // pay
      payableApp.address, payableApp.address, payableApp.address,
      // std
      stdApp.address, stdApp.address, stdApp.address,
      // emit
      emitApp.address, emitApp.address, emitApp.address,
      emitApp.address, emitApp.address, emitApp.address,
      // mix
      mixApp.address, mixApp.address, mixApp.address, mixApp.address,
      mixApp.address, mixApp.address, mixApp.address, mixApp.address,
      // inv
      invalidApp.address, invalidApp.address,
      // rev
      revertApp.address, revertApp.address, revertApp.address,
      // update
      regProvider.address, regProvider.address
    ]
    allowedAddrs.length.should.be.eq(appSelectors.length)

    stdAppCalldata = []
    let cd = await appMockUtil.std1.call(storageLocations[0], storageValues[0])
    cd.should.not.eq('0x0')
    stdAppCalldata.push(cd)
  })

  beforeEach(async () => {
    scriptExec = await ScriptExec.new(
      { from: execAdmin, gasPrice: 0 }
    ).should.be.fulfilled

    scriptExec.configure(
      execAdmin, storage.address, execAdmin,
      { from: execAdmin }
    ).should.be.fulfilled
  })

  describe('#constructor', async () => {

    let testExec

    context('when no exec admin is passed-in', async () => {

      beforeEach(async () => {
        testExec = await ScriptExec.new(
          { from: execAdmin }
        ).should.be.fulfilled

        testExec.configure(
          execAdmin, storage.address, provider,
          { from: execAdmin }
        ).should.be.fulfilled
      })

      it('should set the exec admin address as the sender', async () => {
        let adminInfo = await testExec.exec_admin.call()
        adminInfo.should.be.eq(execAdmin)
      })

      it('should correctly set other initial data', async () => {
        let storageInfo = await testExec.app_storage.call()
        storageInfo.should.be.eq(storage.address)
        let providerInfo = await testExec.provider.call()
        providerInfo.should.be.eq(provider)
      })
    })

    context('when an exec admin is passed-in', async () => {

      beforeEach(async () => {
        testExec = await ScriptExec.new(
          { from: execAdmin }
        ).should.be.fulfilled

        testExec.configure(
          execAdmin, storage.address, provider,
          { from: execAdmin }
        ).should.be.fulfilled
      })

      it('should set the exec admin address as the passed-in address', async () => {
        let adminInfo = await testExec.exec_admin.call()
        adminInfo.should.be.eq(execAdmin)
      })

      it('should correctly set other initial data', async () => {
        let storageInfo = await testExec.app_storage.call()
        storageInfo.should.be.eq(storage.address)
        let providerInfo = await testExec.provider.call()
        providerInfo.should.be.eq(provider)
      })
    })
  })

  describe('#exec', async () => {

    let executionID
    let expectedStatus

    beforeEach(async () => {
      let events = await scriptExec.createRegistryInstance(
        regIdx.address, regProvider.address, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('RegistryInstanceCreated')
      regExecID = events[0].args['execution_id']
      web3.toDecimal(regExecID).should.not.eq(0)

      await scriptExec.registerApp(
        stdAppName, appInit.address, appSelectors, allowedAddrs,
        { from: execAdmin }
      ).should.be.fulfilled

      events = await scriptExec.createAppInstance(
        stdAppName, initCalldata,
        { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('AppInstanceCreated')
      executionID = events[0].args['execution_id']
      web3.toDecimal(executionID).should.not.eq(0)
    })

    describe('invalid inputs or invalid state', async () => {

      context('exec id is 0', async () => {

        let invalidExecID = web3.toHex(0)
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidReturn = await scriptExec.exec.call(
            invalidExecID, stdAppCalldata[0], { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            invalidExecID, stdAppCalldata[0],
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })
    })

    describe('RevertApp (app reverts)', async () => {

      let revertEvents
      let revertReturn

      beforeEach(async () => {
        expectedStatus = false
      })

      describe('function did not exist', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.rev0.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('reverts with no message', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.rev1.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('reverts with message', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.rev2.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })
    })

    describe('InvalidApp (app returns malformed data)', async () => {

      let invalidCalldata

      describe('app attempts to pay storage contract', async () => {

        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.inv1.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('app does not change state', async () => {

        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.inv2.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })
    })

    describe('StdApp (app stores data)', async () => {

      let returnData
      let execEvents

      describe('storing to 0 slots', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.std0.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('storing to one slot', async () => {

        let calldata

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.std1.call(storageLocations[0], storageValues[0])
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 1 event total', async () => {
            execEvents.length.should.be.eq(1)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(stdApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true, readValue)
          })
        })
      })

      describe('storing to 2 slots', async () => {

        let calldata

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.std2.call(
            storageLocations[0], storageValues[0],
            storageLocations[1], storageValues[1]
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 1 event total', async () => {
            execEvents.length.should.be.eq(1)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(stdApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the first location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true)
          })

          it('should have correctly stored the value at the second location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[1])
            hexStrEquals(readValue, storageValues[1]).should.be.eq(true)
          })
        })
      })
    })

    describe('PayableApp (forwards ETH)', async () => {

      let calldata
      let returnData
      let execEvents

      describe('pays out to 0 addresses', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.pay0.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('pays out to 1 address', async () => {

        let initPayeeBalance = 0

        beforeEach(async () => {
          expectedStatus = true

          calldata = await appMockUtil.pay1.call(payees[0])
          calldata.should.not.eq('0x0')
          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled
          initPayeeBalance = web3.eth.getBalance(payees[0])
          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 2 events total', async () => {
            execEvents.length.should.be.eq(2)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payableApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have a data field containing the amount sent', async () => {
              web3.toDecimal(eventData).should.be.eq(payouts[0])
            })
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalance).plus(payouts[0]))
          })
        })
      })

      describe('pays out to 2 addresses', async () => {

        let initPayeeBalances = [0, 0]
        let totalPayout

        beforeEach(async () => {
          expectedStatus = true
          totalPayout = payouts[0] + payouts[1]

          calldata = await appMockUtil.pay2.call(payees[0], payees[1])
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: totalPayout }
          ).should.be.fulfilled

          initPayeeBalances = []
          let payeeBal = web3.eth.getBalance(payees[0])
          initPayeeBalances.push(payeeBal)
          payeeBal = web3.eth.getBalance(payees[1])
          initPayeeBalances.push(payeeBal)

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: totalPayout  }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 3 events total', async () => {
            execEvents.length.should.be.eq(3)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[2].topics
              eventData = execEvents[2].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payableApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment events', async () => {

            let eventTopicsA
            let eventDataA
            let eventTopicsB
            let eventDataB

            beforeEach(async () => {
              eventTopicsA = execEvents[0].topics
              eventDataA = execEvents[0].data
              eventTopicsB = execEvents[1].topics
              eventDataB = execEvents[1].data
            })

            it('should both have the correct number of topics', async () => {
              eventTopicsA.length.should.be.eq(3)
              eventTopicsB.length.should.be.eq(3)
            })

            it('should both list the correct event signature in the first topic', async () => {
              let sig = eventTopicsA[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
              sig = eventTopicsB[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should both have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopicsA[2]
              let emittedExecId = eventTopicsA[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
              emittedAddr = eventTopicsB[2]
              emittedExecId = eventTopicsB[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[1]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should both have a data field containing the amount sent', async () => {
              web3.toDecimal(eventDataA).should.be.eq(totalPayout / 2)
              web3.toDecimal(eventDataB).should.be.eq(totalPayout / 2)
            })
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the first destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalances[0]).plus(totalPayout / 2))
          })

          it('should have delivered the amount to the second destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[1])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalances[1]).plus(totalPayout / 2))
          })
        })
      })
    })

    describe('EmitsApp (app emits events)', async () => {

      let calldata
      let returnData
      let execEvents

      describe('emitting 0 events', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.emit0.call()
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('emitting 1 event with no topics or data', async () => {

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.emit1top0.call()
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 2 events total', async () => {
            execEvents.length.should.be.eq(2)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(emitApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the other event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(0)
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })
        })
      })

      describe('emitting 1 event with no topics with data', async () => {

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.emit1top0data.call(stdAppName)
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 2 events total', async () => {
            execEvents.length.should.be.eq(2)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(emitApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the other event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(0)
            })

            it('should have a data field matching the passed in data', async () => {
              hexStrEquals(eventData, stdAppName).should.be.eq(true, web3.toAscii(eventData))
            })
          })
        })
      })

      describe('emitting 1 event with 4 topics with data', async () => {

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.emit1top4data.call(
            emitTopics[0], emitTopics[1], emitTopics[2], emitTopics[3],
            stdAppName
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 2 events total', async () => {
            execEvents.length.should.be.eq(2)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(emitApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the other event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(4)
            })

            it('should match the topics sent', async () => {
              hexStrEquals(eventTopics[0], emitTopics[0]).should.be.eq(true)
              hexStrEquals(eventTopics[1], emitTopics[1]).should.be.eq(true)
              hexStrEquals(eventTopics[2], emitTopics[2]).should.be.eq(true)
              hexStrEquals(eventTopics[3], emitTopics[3]).should.be.eq(true)
            })

            it('should have a data field matching the sender context', async () => {
              hexStrEquals(eventData, stdAppName).should.be.eq(true, web3.toAscii(eventData))
            })
          })
        })
      })

      describe('emitting 2 events, each with 1 topic and data', async () => {

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.emit2top1data.call(
            emitTopics[0], stdAppName, stdAppName2
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 3 events total', async () => {
            execEvents.length.should.be.eq(3)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[2].topics
              eventData = execEvents[2].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(emitApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the other events', async () => {

            let eventTopicsA
            let eventDataA
            let eventTopicsB
            let eventDataB

            beforeEach(async () => {
              eventTopicsA = execEvents[0].topics
              eventDataA = execEvents[0].data
              eventTopicsB = execEvents[1].topics
              eventDataB = execEvents[1].data
            })

            it('should both have the correct number of topics', async () => {
              eventTopicsA.length.should.be.eq(1)
              eventTopicsB.length.should.be.eq(1)
            })

            it('should both match the topics sent', async () => {
              hexStrEquals(eventTopicsA[0], emitTopics[0]).should.be.eq(true)
              let appTopics2Hex = web3.toHex(
                web3.toBigNumber(eventTopicsB[0]).minus(1)
              )
              hexStrEquals(appTopics2Hex, emitTopics[0]).should.be.eq(true)
            })

            it('should both have a data field matching the sender context', async () => {
              hexStrEquals(eventDataA, stdAppName).should.be.eq(true, web3.toAscii(eventDataA))
              hexStrEquals(eventDataB, stdAppName2).should.be.eq(true, web3.toAscii(eventDataB))
            })
          })
        })
      })

      describe('emitting 2 events, each with 4 topics and no data', async () => {

        beforeEach(async () => {
          expectedStatus = true
          calldata = await appMockUtil.emit2top4.call(
            emitTopics[0], emitTopics[1], emitTopics[2], emitTopics[3]
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 3 events total', async () => {
            execEvents.length.should.be.eq(3)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[2].topics
              eventData = execEvents[2].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(emitApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the other events', async () => {

            let eventTopicsA
            let eventDataA
            let eventTopicsB
            let eventDataB

            beforeEach(async () => {
              eventTopicsA = execEvents[0].topics
              eventDataA = execEvents[0].data
              eventTopicsB = execEvents[1].topics
              eventDataB = execEvents[1].data
            })

            it('should both have the correct number of topics', async () => {
              eventTopicsA.length.should.be.eq(4)
              eventTopicsB.length.should.be.eq(4)
            })

            it('should both match the topics sent', async () => {
              // First topic, both events
              hexStrEquals(eventTopicsA[0], emitTopics[0]).should.be.eq(true)
              let topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[0]).minus(1))
              hexStrEquals(topicHex, emitTopics[0]).should.be.eq(true)
              // Second topic, both events
              hexStrEquals(eventTopicsA[1], emitTopics[1]).should.be.eq(true)
              topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[1]).minus(1))
              hexStrEquals(topicHex, emitTopics[1]).should.be.eq(true)
              // Third topic, both events
              hexStrEquals(eventTopicsA[2], emitTopics[2]).should.be.eq(true)
              topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[2]).minus(1))
              hexStrEquals(topicHex, emitTopics[2]).should.be.eq(true)
              // Fourth topic, both events
              hexStrEquals(eventTopicsA[3], emitTopics[3]).should.be.eq(true)
              topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[3]).minus(1))
              hexStrEquals(topicHex, emitTopics[3]).should.be.eq(true)
            })

            it('should both have an empty data field', async () => {
              eventDataA.should.be.eq('0x0')
              eventDataB.should.be.eq('0x0')
            })
          })
        })
      })
    })

    describe('MixedApp (app requests various actions from storage. order/amt not vary)', async () => {

      let calldata
      let returnData
      let execEvents

      beforeEach(async () => {
        expectedStatus = true
      })

      describe('2 actions (EMITS 1, THROWS)', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.req0.call(emitTopics[0])
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('2 actions (PAYS 1, STORES 1)', async () => {

        let initPayeeBalance = 0

        beforeEach(async () => {
          calldata = await appMockUtil.req1.call(payees[0], storageLocations[0], storageValues[0])
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled

          initPayeeBalance = web3.eth.getBalance(payees[0])

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 2 events total', async () => {
            execEvents.length.should.be.eq(2)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(mixApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have a data field containing the amount sent', async () => {
              web3.toDecimal(eventData).should.be.eq(payouts[0])
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true, readValue)
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalance).plus(payouts[0]))
          })
        })
      })

      describe('2 actions (EMITS 1, STORES 1)', async () => {

        beforeEach(async () => {
          calldata = await appMockUtil.req2.call(emitTopics[0], storageLocations[0], storageValues[0])
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 2 events total', async () => {
            execEvents.length.should.be.eq(2)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(mixApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the other event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(1)
            })

            it('should match the expected topics', async () => {
              hexStrEquals(eventTopics[0], emitTopics[0]).should.be.eq(true)
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true)
          })
        })
      })

      describe('2 actions (PAYS 1, EMITS 1)', async () => {

        let initPayeeBalance

        beforeEach(async () => {
          calldata = await appMockUtil.req3.call(payees[0], emitTopics[0])
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled

          initPayeeBalance = web3.eth.getBalance(payees[0])

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 3 events total', async () => {
            execEvents.length.should.be.eq(3)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[2].topics
              eventData = execEvents[2].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(mixApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have a data field containing the amount sent', async () => {
              web3.toDecimal(eventData).should.be.eq(payouts[0])
            })
          })

          describe('the other event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(1)
            })

            it('should match the expected topics', async () => {
              hexStrEquals(eventTopics[0], emitTopics[0]).should.be.eq(true)
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalance).plus(payouts[0]))
          })
        })
      })

      describe('3 actions (PAYS 2, EMITS 1, THROWS)', async () => {

        let invalidCalldata
        let invalidEvents
        let invalidReturn

        beforeEach(async () => {
          invalidCalldata = await appMockUtil.reqs0.call(
            payees[0], payees[1], emitTopics[0], stdAppName
          )
          invalidCalldata.should.not.eq('0x0')

          invalidReturn = await scriptExec.exec.call(
            executionID, invalidCalldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled
          invalidEvents = await scriptExec.exec(
            executionID, invalidCalldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
        })

        it('should emit a StorageException event', async () => {
          invalidEvents.length.should.be.eq(1)
          invalidEvents[0].event.should.be.eq('StorageException')
        })

        it('should return false', async () => {
          invalidReturn.should.be.eq(false)
        })
      })

      describe('3 actions (EMITS 2, PAYS 1, STORES 2)', async () => {

        let initPayeeBalance

        beforeEach(async () => {
          calldata = await appMockUtil.reqs1.call(
            payees[0], stdAppName, stdAppName2,
            storageLocations[0], storageValues[0],
            storageLocations[1], storageValues[1]
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled

          initPayeeBalance = web3.eth.getBalance(payees[0])

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 4 events total', async () => {
            execEvents.length.should.be.eq(4)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[3].topics
              eventData = execEvents[3].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(mixApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[2].topics
              eventData = execEvents[2].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have a data field containing the amount sent', async () => {
              web3.toDecimal(eventData).should.be.eq(payouts[0])
            })
          })

          describe('the other events', async () => {

            let eventTopicsA
            let eventDataA
            let eventTopicsB
            let eventDataB

            beforeEach(async () => {
              eventTopicsA = execEvents[0].topics
              eventDataA = execEvents[0].data
              eventTopicsB = execEvents[1].topics
              eventDataB = execEvents[1].data
            })

            it('should both have the correct number of topics', async () => {
              eventTopicsA.length.should.be.eq(0)
              eventTopicsB.length.should.be.eq(0)
            })

            it('should both have a data field matching the sender context', async () => {
              hexStrEquals(eventDataA, stdAppName).should.be.eq(true)
              hexStrEquals(eventDataB, stdAppName2).should.be.eq(true)
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the first location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true)
          })

          it('should have correctly stored the value at the second location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[1])
            hexStrEquals(readValue, storageValues[1]).should.be.eq(true)
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalance).plus(payouts[0]))
          })
        })
      })

      describe('3 actions (PAYS 1, EMITS 3, STORES 1)', async () => {

        let initPayeeBalance

        beforeEach(async () => {
          calldata = await appMockUtil.reqs2.call(
            payees[0], emitTopics, stdAppName,
            storageLocations[0], storageValues[0]
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled

          initPayeeBalance = web3.eth.getBalance(payees[0])

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 4 events total', async () => {
            execEvents.length.should.be.eq(5)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[4].topics
              eventData = execEvents[4].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(mixApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have a data field containing the amount sent', async () => {
              web3.toDecimal(eventData).should.be.eq(payouts[0])
            })
          })

          describe('the other events', async () => {

            let eventTopicsA
            let eventDataA
            let eventTopicsB
            let eventDataB
            let eventTopicsC
            let eventDataC


            beforeEach(async () => {
              eventTopicsA = execEvents[1].topics
              eventDataA = execEvents[1].data
              eventTopicsB = execEvents[2].topics
              eventDataB = execEvents[2].data
              eventTopicsC = execEvents[3].topics
              eventDataC = execEvents[3].data
            })

            context('event A', async () => {

              it('should have the correct number of topics', async () => {
                eventTopicsA.length.should.be.eq(4)
              })

              it('should match the passed in topics', async () => {
                hexStrEquals(eventTopicsA[0], emitTopics[0]).should.be.eq(true)
                hexStrEquals(eventTopicsA[1], emitTopics[1]).should.be.eq(true)
                hexStrEquals(eventTopicsA[2], emitTopics[2]).should.be.eq(true)
                hexStrEquals(eventTopicsA[3], emitTopics[3]).should.be.eq(true)
              })

              it('should have a data field matching the sender context', async () => {
                hexStrEquals(eventDataA, stdAppName).should.be.eq(true)
              })
            })

            context('event B', async () => {

              it('should have the correct number of topics', async () => {
                eventTopicsB.length.should.be.eq(4)
              })

              it('should match the passed in topics', async () => {
                let topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[0]).minus(1))
                hexStrEquals(topicHex, emitTopics[0]).should.be.eq(true)
                topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[1]).minus(1))
                hexStrEquals(topicHex, emitTopics[1]).should.be.eq(true)
                topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[2]).minus(1))
                hexStrEquals(topicHex, emitTopics[2]).should.be.eq(true)
                topicHex = web3.toHex(web3.toBigNumber(eventTopicsB[3]).minus(1))
                hexStrEquals(topicHex, emitTopics[3]).should.be.eq(true)
              })

              it('should have a data field matching the sender context', async () => {
                hexStrEquals(eventDataB, stdAppName).should.be.eq(true)
              })
            })

            context('event C', async () => {

              it('should have the correct number of topics', async () => {
                eventTopicsC.length.should.be.eq(4)
              })

              it('should match the passed in topics', async () => {
                let topicHex = web3.toHex(web3.toBigNumber(eventTopicsC[0]).minus(2))
                hexStrEquals(topicHex, emitTopics[0]).should.be.eq(true)
                topicHex = web3.toHex(web3.toBigNumber(eventTopicsC[1]).minus(2))
                hexStrEquals(topicHex, emitTopics[1]).should.be.eq(true)
                topicHex = web3.toHex(web3.toBigNumber(eventTopicsC[2]).minus(2))
                hexStrEquals(topicHex, emitTopics[2]).should.be.eq(true)
                topicHex = web3.toHex(web3.toBigNumber(eventTopicsC[3]).minus(2))
                hexStrEquals(topicHex, emitTopics[3]).should.be.eq(true)
              })

              it('should have a data field matching the sender context', async () => {
                hexStrEquals(eventDataC, stdAppName).should.be.eq(true)
              })
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true)
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalance).plus(payouts[0]))
          })
        })
      })

      describe('3 actions (STORES 2, PAYS 1, EMITS 1)', async () => {

        let initPayeeBalance

        beforeEach(async () => {
          calldata = await appMockUtil.reqs3.call(
            payees[0], emitTopics[0], stdAppName,
            storageLocations[0], storageValues[0],
            storageLocations[1], storageValues[1]
          )
          calldata.should.not.eq('0x0')

          returnData = await scriptExec.exec.call(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled

          initPayeeBalance = web3.eth.getBalance(payees[0])

          execEvents = await scriptExec.exec(
            executionID, calldata,
            { from: sender, value: payouts[0] }
          ).should.be.fulfilled.then((tx) => {
            return tx.receipt.logs
          })
        })

        describe('returned data', async () => {

          it('should return the expected status', async () => {
            returnData.should.be.eq(expectedStatus)
          })
        })

        describe('events', async () => {

          it('should have emitted 3 events total', async () => {
            execEvents.length.should.be.eq(3)
          })

          describe('the ApplicationExecution event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[2].topics
              eventData = execEvents[2].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(execHash))
            })

            it('should have the target app address and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(mixApp.address))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have an empty data field', async () => {
              eventData.should.be.eq('0x0')
            })
          })

          describe('the DeliveredPayment event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[0].topics
              eventData = execEvents[0].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(3)
            })

            it('should list the correct event signature in the first topic', async () => {
              let sig = eventTopics[0]
              web3.toDecimal(sig).should.be.eq(web3.toDecimal(payHash))
            })

            it('should have the payment destination and execution id as the other 2 topics', async () => {
              let emittedAddr = eventTopics[2]
              let emittedExecId = eventTopics[1]
              web3.toDecimal(emittedAddr).should.be.eq(web3.toDecimal(payees[0]))
              web3.toDecimal(emittedExecId).should.be.eq(web3.toDecimal(executionID))
            })

            it('should have a data field containing the amount sent', async () => {
              web3.toDecimal(eventData).should.be.eq(payouts[0])
            })
          })

          describe('the other event', async () => {

            let eventTopics
            let eventData

            beforeEach(async () => {
              eventTopics = execEvents[1].topics
              eventData = execEvents[1].data
            })

            it('should have the correct number of topics', async () => {
              eventTopics.length.should.be.eq(1)
            })

            it('should match the expected topics', async () => {
              hexStrEquals(eventTopics[0], emitTopics[0]).should.be.eq(true)
            })

            it('should a data field matching the sender context', async () => {
              hexStrEquals(eventData, stdAppName).should.be.eq(true)
            })
          })
        })

        describe('storage', async () => {

          it('should have correctly stored the value at the first location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[0])
            hexStrEquals(readValue, storageValues[0]).should.be.eq(true)
          })

          it('should have correctly stored the value at the second location', async () => {
            let readValue = await storage.read.call(executionID, storageLocations[1])
            hexStrEquals(readValue, storageValues[1]).should.be.eq(true)
          })
        })

        describe('payment', async () => {

          it('should have delivered the amount to the destination', async () => {
            let curPayeeBalance = web3.eth.getBalance(payees[0])
            curPayeeBalance.should.be.bignumber.eq(web3.toBigNumber(initPayeeBalance).plus(payouts[0]))
          })
        })
      })
    })
  })

  describe('#createAppInstance', async () => {

    let registryExecID

    let appName = 'AppName1'
    let versionNameOne = 'v0.0.1'
    let versionNameTwo = 'v0.0.2'

    let registerAppCalldata
    let registerVersionOneCalldata
    let registerVersionTwoCalldata

    beforeEach(async () => {
      let events = await scriptExec.createRegistryInstance(
        regIdx.address, regProvider.address, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('RegistryInstanceCreated')
      regExecID = events[0].args['execution_id']
      web3.toDecimal(regExecID).should.not.eq(0)

      await scriptExec.registerApp(
        stdAppName, regIdx.address, appSelectors, allowedAddrs,
        { from: execAdmin }
      ).should.be.fulfilled

      await scriptExec.registerAppVersion(
        stdAppName, version1, regIdx.address, appSelectors, allowedAddrs,
        { from: execAdmin }
      ).should.be.fulfilled
    })

    context('app does not exist in script registry', async () => {

      let invalidAppName = 'invalid'

      it('should throw', async () => {
        await scriptExec.createAppInstance(
          invalidAppName, initCalldata,
          { from: sender }
        ).should.not.be.fulfilled
      })
    })

    context('app name is invalid', async () => {

      let invalidAppName = ''

      it('should throw', async () => {
        await scriptExec.createAppInstance(
          invalidAppName, initCalldata,
          { from: sender }
        ).should.not.be.fulfilled
      })
    })

    context('app init calldata is too short', async () => {

      let invalidCalldata = '0xaabb'

      it('should throw', async () => {
        await scriptExec.createAppInstance(
          appName, invalidCalldata,
          { from: sender }
        ).should.not.be.fulfilled
      })
    })
  })

  describe('#setAdmin', async () => {

    let newAdmin = accounts[5]

    context('sender is not the admin', async () => {

      it('should throw', async () => {
        await scriptExec.setAdmin(
          newAdmin, { from: updater }
        ).should.not.be.fulfilled
      })
    })

    context('sender is the admin', async () => {

      beforeEach(async () => {
        await scriptExec.setAdmin(
          newAdmin, { from: execAdmin }
        ).should.be.fulfilled
      })

      it('should have a new exec admin address', async () => {
        let execInfo = await scriptExec.exec_admin.call()
        execInfo.should.be.eq(newAdmin)
      })
    })
  })

  describe('#setProvider', async () => {

    let newProvider = accounts[5]

    context('sender is not the admin', async () => {

      it('should throw', async () => {
        await scriptExec.setProvider(
          newProvider, { from: updater }
        ).should.not.be.fulfilled
      })
    })

    context('sender is the admin', async () => {

      beforeEach(async () => {
        await scriptExec.setProvider(
          newProvider, { from: execAdmin }
        ).should.be.fulfilled
      })

      it('should have a new default provider id', async () => {
        let execInfo = await scriptExec.provider.call()
        execInfo.should.be.eq(newProvider)
      })
    })
  })

  describe('#setRegistryExecID', async () => {

    let newExecID = web3.toHex(0)

    context('sender is not the admin', async () => {

      it('should throw', async () => {
        await scriptExec.setRegistryExecID(
          newExecID, { from: updater }
        ).should.not.be.fulfilled
      })
    })

    context('sender is the admin', async () => {

      beforeEach(async () => {
        await scriptExec.setRegistryExecID(
          newExecID, { from: execAdmin }
        ).should.be.fulfilled
      })

      it('should have a new default registry exec id', async () => {
        let execInfo = await scriptExec.registry_exec_id.call()
        web3.toDecimal(execInfo).should.be.eq(web3.toDecimal(newExecID))
      })
    })
  })

  describe('#createRegistryInstance', async () => {

    context('invalid input', async () => {

      let invalidAddr = web3.toHex(0)

      context('invalid index address', async () => {

        it('should throw', async () => {
          await scriptExec.createRegistryInstance(
            invalidAddr, regProvider.address
          ).should.not.be.fulfilled
        })
      })

      context('invalid impl address', async () => {

        it('should throw', async () => {
          await scriptExec.createRegistryInstance(
            regIdx.address, invalidAddr
          ).should.not.be.fulfilled
        })
      })
    })

    context('when there is not already a set registry exec id', async () => {

      let createEvent
      let newRegExecId

      beforeEach(async () => {
        let events = await scriptExec.createRegistryInstance(
          regIdx.address, regProvider.address, { from: execAdmin }
        ).should.be.fulfilled.then((tx) => {
          return tx.logs
        })
        events.should.not.eq(null)
        events.length.should.be.eq(1)
        createEvent = events[0]
        newRegExecId = createEvent.args['execution_id']
        web3.toDecimal(newRegExecId).should.not.eq(0)
      })

      it('should set the contract registry exec id to the emitted exec id', async () => {
        let execInfo = await scriptExec.registry_exec_id.call()
        execInfo.should.be.eq(newRegExecId)
      })

      it('should emit a RegistryInstanceCreated event', async () => {
        createEvent.event.should.be.eq('RegistryInstanceCreated')
      })

      it('store the correct addresses as registry instance info', async () => {
        let addrInfo = await scriptExec.registry_instance_info.call(newRegExecId)
        addrInfo.length.should.be.eq(2)
        addrInfo[0].should.be.eq(regIdx.address)
        addrInfo[1].should.be.eq(regProvider.address)
      })
    })

    context('when there is already a set registry exec id', async () => {

      let createEvent
      let newRegExecId

      beforeEach(async () => {
        await scriptExec.setRegistryExecID(web3.sha3('A'), { from: execAdmin }).should.be.fulfilled

        let events = await scriptExec.createRegistryInstance(
          regIdx.address, regProvider.address, { from: execAdmin }
        ).should.be.fulfilled.then((tx) => {
          return tx.logs
        })
        events.should.not.eq(null)
        events.length.should.be.eq(1)
        createEvent = events[0]
        newRegExecId = createEvent.args['execution_id']
        web3.toDecimal(newRegExecId).should.not.eq(0)
      })

      it('should match the original exec id set', async () => {
        let execInfo = await scriptExec.registry_exec_id.call()
        execInfo.should.be.eq(web3.sha3('A'))
      })

      it('should emit a RegistryInstanceCreated event', async () => {
        createEvent.event.should.be.eq('RegistryInstanceCreated')
      })

      it('store the correct addresses as registry instance info', async () => {
        let addrInfo = await scriptExec.registry_instance_info.call(newRegExecId)
        addrInfo.length.should.be.eq(2)
        addrInfo[0].should.be.eq(regIdx.address)
        addrInfo[1].should.be.eq(regProvider.address)
      })
    })
  })

  describe('#registerApp', async () => {

    let registryExecID

    beforeEach(async () => {
      let events = await scriptExec.createRegistryInstance(
        regIdx.address, regProvider.address, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('RegistryInstanceCreated')
      registryExecID = events[0].args['execution_id']
    })

    context('invalid input', async () => {

      describe('invalid index address', async () => {

        it('should throw', async () => {
          await scriptExec.registerApp(
            stdAppName, zeroAddress(), appSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })

      describe('invalid app name', async () => {

        let invalidName = ''

        it('should throw', async () => {
          await scriptExec.registerApp(
            invalidName, regIdx.address, appSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })

      describe('invalid input length', async () => {

        let invalidSelectors = ['0xdeadbeef']

        it('should throw', async () => {
          await scriptExec.registerApp(
            stdAppName, regIdx.address, invalidSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })

      describe('unset registry exec id', async () => {

        beforeEach(async () => {
          await scriptExec.setRegistryExecID(web3.toHex(0))
        })

        it('should throw', async () => {
          await scriptExec.registerApp(
            stdAppName, regIdx.address, appSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })
    })

    context('app already exists', async () => {

      beforeEach(async () => {
        await scriptExec.registerApp(
          stdAppName, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
      })

      it('should throw', async () => {
        await scriptExec.registerApp(
          stdAppName, regIdx.address, appSelectors, allowedAddrs
        ).should.not.be.fulfilled
      })
    })

    context('app does not already exist', async () => {

      beforeEach(async () => {
        await scriptExec.registerApp(
          stdAppName, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
      })

      it('should return the app\'s own name as its only version', async () => {
        let versionInfo = await regIdx.getVersions.call(
          storage.address, registryExecID, execAdmin, stdAppName
        ).should.be.fulfilled
        versionInfo.length.should.be.eq(1)
        hexStrEquals(versionInfo[0], stdAppName).should.be.eq(true)
      })
    })
  })

  describe('#registerAppVersion', async () => {

    let registryExecID

    beforeEach(async () => {
      let events = await scriptExec.createRegistryInstance(
        regIdx.address, regProvider.address, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('RegistryInstanceCreated')
      registryExecID = events[0].args['execution_id']
    })

    context('invalid input', async () => {

      beforeEach(async () => {
        await scriptExec.registerApp(
          stdAppName, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
      })

      describe('invalid index address', async () => {

        it('should throw', async () => {
          await scriptExec.registerAppVersion(
            stdAppName, version1, zeroAddress(), appSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })

      describe('invalid version name', async () => {

        let invalidName = ''

        it('should throw', async () => {
          await scriptExec.registerAppVersion(
            stdAppName, invalidName, regIdx.address, appSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })

      describe('invalid input length', async () => {

        let invalidSelectors = ['0xdeadbeef']

        it('should throw', async () => {
          await scriptExec.registerAppVersion(
            stdAppName, version1, regIdx.address, invalidSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })

      describe('unset registry exec id', async () => {

        beforeEach(async () => {
          await scriptExec.setRegistryExecID(web3.toHex(0))
        })

        it('should throw', async () => {
          await scriptExec.registerAppVersion(
            stdAppName, version1, regIdx.address, appSelectors, allowedAddrs
          ).should.not.be.fulfilled
        })
      })
    })

    context('app does not already exist', async () => {

      it('should throw', async () => {
        await scriptExec.registerAppVersion(
          stdAppName, version1, regIdx.address, appSelectors, allowedAddrs
        ).should.not.be.fulfilled
      })
    })

    context('app exists, version already exists', async () => {

      beforeEach(async () => {
        await scriptExec.registerApp(
          stdAppName, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
        await scriptExec.registerAppVersion(
          stdAppName, version1, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
      })

      it('should throw', async () => {
        await scriptExec.registerAppVersion(
          stdAppName, version1, regIdx.address, appSelectors, allowedAddrs
        ).should.not.be.fulfilled
      })
    })

    context('app exists, version does not exist', async () => {

      beforeEach(async () => {
        await scriptExec.registerApp(
          stdAppName, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
        await scriptExec.registerAppVersion(
          stdAppName, version1, regIdx.address, appSelectors, allowedAddrs
        ).should.be.fulfilled
      })

      it('should return an app version list length of 2', async () => {
        let versionInfo = await regIdx.getVersions.call(
          storage.address, registryExecID, execAdmin, stdAppName
        ).should.be.fulfilled
        versionInfo.length.should.be.eq(2)
        hexStrEquals(versionInfo[0], stdAppName).should.be.eq(true)
        hexStrEquals(versionInfo[1], version1).should.be.eq(true)
      })
    })
  })

  describe('#updateExec', async () => {

    let initCalldata
    let registryExecID

    beforeEach(async () => {
      let events = await scriptExec.createRegistryInstance(
        regIdx.address, regProvider.address, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('RegistryInstanceCreated')
      registryExecID = events[0].args['execution_id']
      registryExecID.should.not.eq(0)
    })

    describe('invalid input', async () => {

      context('sender is not deployer', async () => {

        it('should throw', async () => {
          await scriptExec.updateAppExec(
            registryExecID, payees[0],
            { from: updater }
          ).should.not.be.fulfilled
        })
      })

      context('execID is zero', async () => {

        it('should throw', async () => {
          await scriptExec.updateAppExec(
            Utils.BYTES32_EMPTY, updater,
            { from: execAdmin }
          ).should.not.be.fulfilled
        })
      })

      context('replacement is address zero', async () => {

        it('should throw', async () => {
          await scriptExec.updateAppExec(
            registryExecID,  Utils.ADDRESS_0x,
            { from: execAdmin }
          ).should.not.be.fulfilled
        })

      })

      context('replacement is this ScriptExec', async () => {

        it('should return false', async () => {
          await scriptExec.updateAppExec(
            registryExecID, scriptExec.address,
            { from: execAdmin }
          ).should.not.be.fulfilled
        })
      })
    })

    describe('valid ScriptExec update', async () => {

      let newScriptExec

      beforeEach(async () => {
        newScriptExec = await ScriptExecMock.new({ from: execAdmin }).should.be.fulfilled

        newScriptExec.configure(
          execAdmin, storage.address, provider,
          { from: execAdmin }
        ).should.be.fulfilled
      })

      describe('a successful update', async () => {

        beforeEach(async () => {
          await scriptExec.updateAppExec(
            registryExecID, newScriptExec.address,
            { from: execAdmin }
          ).should.be.fulfilled
        })

        it('should not accept execution from the old script exec contract', async () => {
          let events = await scriptExec.updateAppExec(
            registryExecID, newScriptExec.address,
            { from: execAdmin }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })

          events.length.should.be.eq(1)
          events[0].args['execution_id'].should.be.eq(registryExecID)
          events[0].args['message'].should.be.eq('Sender is not authorized as a script exec address')
        })

        it('should accept execution from the new script exec contract', async () => {
          await newScriptExec.updateAppExec(
            registryExecID, scriptExec.address,
            { from: execAdmin }
          ).should.be.fulfilled
        })
      })
    })
  })

  describe('#updateInstance', async () => {

    let registryExecID

    let updateExecId

    // let v1Selectors = []

    beforeEach(async () => {
      let events = await scriptExec.createRegistryInstance(
        regIdx.address, regProvider.address, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.should.not.eq(null)
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('RegistryInstanceCreated')
      registryExecID = events[0].args['execution_id']
      registryExecID.should.not.eq(0)

      events = await scriptExec.registerApp(
        stdAppName, regIdx.address, appSelectors, allowedAddrs,
        { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.length.should.be.eq(0)

      events = await scriptExec.createAppInstance(
        stdAppName, initCalldata, { from: execAdmin }
      ).should.be.fulfilled.then((tx) => {
        return tx.logs
      })
      events.length.should.be.eq(1)
      events[0].event.should.be.eq('AppInstanceCreated')
      updateExecId = events[0].args['execution_id']
      web3.toDecimal(updateExecId).should.not.eq(0)
    })

    describe('invalid input', async () => {

      context('sender is not deployer', async () => {

        it('should throw', async () => {
          await scriptExec.updateAppInstance(
            updateExecId, { from: updater }
          ).should.not.be.fulfilled
        })
      })

      context('execID is zero', async () => {

        it('should throw', async () => {
          await scriptExec.updateAppInstance(
            Utils.BYTES32_EMPTY,
            { from: execAdmin }
          ).should.not.be.fulfilled
        })
      })

      context('app is already at latest version', async () => {

        it('should emit an error event', async () => {
          let events = await scriptExec.updateAppInstance(
            updateExecId, { from: execAdmin }
          ).then((tx) => {
            return tx.logs
          })
          events.length.should.be.eq(1)
          events[0].event.should.be.eq('StorageException')
        })

      })
    })

    describe('valid app update', async () => {

      let newIdx
      let newSelectors = []
      let newAddrs = []

      let versionName = 'v2'

      beforeEach(async () => {
        newIdx = await RegistryIdx.new().should.be.fulfilled
        newSelectors = appSelectors.slice(0, 6)
        newAddrs = allowedAddrs.slice(0, 6)
      })

      describe('a successful update', async () => {

        beforeEach(async () => {
          await scriptExec.registerAppVersion(
            stdAppName, versionName, newIdx.address, newSelectors, newAddrs,
            { from: execAdmin }
          ).should.be.fulfilled

          let events = await scriptExec.updateAppInstance(
            updateExecId, { from: execAdmin }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
          events.length.should.be.eq(0)
        })

        it('should correctly set the new index address', async () => {
          let idxInfo = await storage.getIndex.call(updateExecId).should.be.fulfilled
          idxInfo.should.be.eq(newIdx.address)
        })

        it('should correctly update the instance version name', async () => {
          let verInfo = await scriptExec.instance_info.call(updateExecId).should.be.fulfilled
          hexStrEquals(verInfo[4], versionName).should.be.eq(true)
        })

        it('should not allow execution of removed functions', async () => {
          let invalidCalldata = await appMockUtil.emit1top0data.call(emitTopics[0]).should.be.fulfilled
          web3.toDecimal(invalidCalldata).should.not.eq(0)
          let events = await scriptExec.exec(
            updateExecId, invalidCalldata,
            { from: execAdmin }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
          events.length.should.be.eq(1)
          events[0].event.should.be.eq('StorageException')
        })

        it('should allow execution of existing functions', async () => {
          let validCalldata = await appMockUtil.std1.call(storageLocations[0], storageValues[0]).should.be.fulfilled
          web3.toDecimal(validCalldata).should.not.eq(0)
          let events = await scriptExec.exec(
            updateExecId, validCalldata,
            { from: execAdmin }
          ).should.be.fulfilled.then((tx) => {
            return tx.logs
          })
          events.length.should.be.eq(0)
        })
      })
    })
  })
})
