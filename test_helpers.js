const Web3Utils = require('web3-utils')
const _ = require('lodash')
const { calculateTakeAmount, calculateGiveAmount } = require('.')

const oneEther = Web3Utils.toBN(Web3Utils.toWei('1'))
const zero = Web3Utils.toBN('0')

const generateTestOrders = (orders) => {
  const defaultOrder = { 
    type: 'sell',
    price: '0',
    amount: '0',
    filled: '0',
    createdAt: '2019-06-19T20:25:59.459Z',
    orderHash: 'SELL#0'
  }
  const baseAddress = "0x0000000000000000000000000000000000000000"
  const quoteAddress = "0xe62cc4212610289d7374f72c2390a40e78583350"
  orders = orders.map(order => {
    const emptyAttrs = []
    // initialize undefined attrs with default ones
    for (let key of Object.keys(defaultOrder)) {
      if (!order[key]) {
        order[key] = defaultOrder[key]
        emptyAttrs.push(key)
      }
    }
    order.amount = Web3Utils.toBN(Web3Utils.toWei(order.amount))
    order.price = Web3Utils.toBN(Web3Utils.toWei(order.price))
    order.filled = Web3Utils.toBN(Web3Utils.toWei(order.filled))
    let giveTokenAddress, giveAmount, takeTokenAddress, takeAmount
    if (order.type === 'buy') {
      giveTokenAddress = baseAddress
      giveAmount = order.amount.mul(order.price).div(oneEther)
      takeTokenAddress = quoteAddress
      takeAmount = order.amount
    } else {
      giveTokenAddress = quoteAddress
      giveAmount = order.amount
      takeTokenAddress = baseAddress
      takeAmount = order.amount.mul(order.price).div(oneEther)
    }
    const createdAt = order.createdAt
    const orderHash = order.orderHash
    const type = order.type
    const filled = type === 'buy' ? calculateGiveAmount(order.filled, giveAmount, takeAmount) : order.filled
    order = { giveTokenAddress, giveAmount: giveAmount.toString(), takeTokenAddress, takeAmount: takeAmount.toString(), createdAt, orderHash, type, filled: filled.toString() }
    // remove undefined attrs
    for (let key of emptyAttrs) {
      delete order[key]
    }
    return order
  })
  return orders
}

const generateTestTrades = (trades) => {
  trades = trades.map(trade => {
    trade.amount = Web3Utils.toWei(trade.amount)
    return trade
  })
  return trades
}

module.exports = {
  generateTestTrades,
  generateTestOrders
}