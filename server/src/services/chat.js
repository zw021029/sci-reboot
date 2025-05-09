const Message = require('../models/message');
const { Knowledge } = require('../models/knowledge');
const logger = require('../utils/logger');
const { getEmbedding, calculateSimilarity } = require('../utils/embedding');
const aiService = require('./ai');
const User = require('../models/user');
const Chat = require('../models/chat');
const Robot = require('../models/robot');
const robotService = require('./robot');

// 获取聊天历史
exports.getChatHistory = async (userId) => {
  try {
    // 获取用户选择的机器人
    const user = await User.findById(userId);
    if (!user || !user.selectedRobot) {
      throw new Error('用户未选择机器人');
    }

    // 获取所有对话
    const chats = await Chat.find({ 
      userId,
      robotId: user.selectedRobot 
    })
    .sort({ createdAt: -1 })
    .populate('userMessage robotReply');

    // 获取所有消息
    const messages = await Message.find({
      userId,
      robotId: user.selectedRobot
    })
    .sort({ createdAt: 1 });

    // 按时间顺序组织消息
    const messageList = messages.map(msg => ({
      _id: msg._id,
      id: msg._id,
      content: msg.content,
      type: msg.type,
      createdAt: msg.createdAt,
      isUser: msg.type === 'user'
    }));

    return {
      robotId: user.selectedRobot,
      messages: messageList,
      chats: chats.map(chat => ({
        _id: chat._id,
        id: chat._id,
        userMessage: chat.userMessage ? {
          _id: chat.userMessage._id,
          id: chat.userMessage._id,
          content: chat.userMessage.content,
          createdAt: chat.userMessage.createdAt
        } : null,
        robotReply: chat.robotReply ? {
          _id: chat.robotReply._id,
          id: chat.robotReply._id,
          content: chat.robotReply.content,
          createdAt: chat.robotReply.createdAt
        } : null,
        createdAt: chat.createdAt
      }))
    };
  } catch (error) {
    logger.error('获取聊天历史失败:', error);
    throw error;
  }
};

// 保存消息
exports.saveMessage = async (userId, content, type, robotId = null) => {
  try {
    // 参数检查
    if (!userId || !content || !type) {
      logger.error('保存消息失败: 缺少必要参数', { userId, content, type });
      throw new Error('缺少必要参数');
    }

    // 获取用户选择的机器人
    const user = await User.findById(userId);
    if (!user) {
      logger.error('保存消息失败: 用户不存在', { userId });
      throw new Error('用户不存在');
    }

    if (!user.selectedRobot) {
      logger.error('保存消息失败: 用户未选择机器人', { userId });
      throw new Error('用户未选择机器人');
    }

    // 创建新的对话或获取最新的对话
    let chat = await Chat.findOne({
      userId,
      robotId: user.selectedRobot
    }).sort({ createdAt: -1 });

    if (!chat) {
      chat = await Chat.create({
        userId,
        robotId: user.selectedRobot,
        userMessage: null,
        robotReply: null
      });
      logger.info('创建新对话', { chatId: chat._id });
    }

    // 保存消息
    const message = await Message.create({
      userId,
      robotId: robotId || user.selectedRobot,
      content,
      type,
      chatId: chat._id
    });

    if (!message || !message._id) {
      logger.error('保存消息失败: 消息创建失败');
      throw new Error('消息创建失败');
    }

    // 更新对话的消息
    if (type === 'user') {
      await Chat.updateOne(
        { _id: chat._id },
        { $set: { userMessage: message._id } }
      );
      logger.info('更新用户消息', { chatId: chat._id, messageId: message._id });
    } else if (type === 'robot') {
      await Chat.updateOne(
        { _id: chat._id },
        { $set: { robotReply: message._id } }
      );
      logger.info('更新机器人回复', { chatId: chat._id, messageId: message._id });
    }

    return message;
  } catch (error) {
    logger.error('保存消息失败:', error);
    throw error;
  }
};

// 获取对话详情
exports.getChatDetail = async (chatId, userId) => {
  try {
    const chat = await Chat.findOne({
      _id: chatId,
      userId
    }).populate('userMessage robotReply');

    if (!chat) {
      return null;
    }

    // 转换为包含 id 字段的对象
    const result = {
      _id: chat._id,
      id: chat._id,
      userId: chat.userId,
      robotId: chat.robotId,
      userMessage: chat.userMessage ? {
        _id: chat.userMessage._id,
        id: chat.userMessage._id,
        content: chat.userMessage.content,
        type: chat.userMessage.type,
        createdAt: chat.userMessage.createdAt
      } : null,
      robotReply: chat.robotReply ? {
        _id: chat.robotReply._id,
        id: chat.robotReply._id,
        content: chat.robotReply.content,
        type: chat.robotReply.type,
        createdAt: chat.robotReply.createdAt
      } : null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    };

    return result;
  } catch (error) {
    logger.error('获取对话详情失败:', error);
    throw error;
  }
};

// 获取机器人回复
exports.getRobotReply = async (userId, message) => {
  try {
    // 参数检查
    if (!userId || !message) {
      logger.error('获取机器人回复失败: 缺少必要参数', { userId, message });
      throw new Error('缺少必要参数');
    }

    // 获取用户选择的机器人
    const user = await User.findById(userId);
    if (!user) {
      logger.error('获取机器人回复失败: 用户不存在', { userId });
      throw new Error('用户不存在');
    }

    if (!user.selectedRobot) {
      logger.error('获取机器人回复失败: 用户未选择机器人', { userId });
      throw new Error('用户未选择机器人');
    }

    logger.info('开始生成机器人回复', { userId, message, robotName: user.selectedRobot });

    // 获取用户消息的向量表示
    const userVector = await getEmbedding(message);
    if (!userVector) {
      logger.error('获取机器人回复失败: 无法生成向量表示');
      throw new Error('无法生成向量表示');
    }

    // 从知识库中查找最相关的答案
    const { KnowledgeArticle } = require('../models/knowledge');
    // 查询通用知识库(robotName='all')，而不是针对特定机器人
    const knowledgeList = await KnowledgeArticle.find({ 
      $or: [
        { robotName: 'all' }, 
        { robotName: user.selectedRobot }
      ] 
    });
    console.log(`找到 ${knowledgeList.length} 条知识库记录`);
    logger.info(`找到 ${knowledgeList.length} 条知识库记录`, { robotName: user.selectedRobot });
    if (!knowledgeList || knowledgeList.length === 0) {
      logger.warn('知识库为空，使用默认回复', { robotName: user.selectedRobot });
      return {
        _id: null,
        id: null,
        content: `抱歉，${user.selectedRobot === '悉文' ? '俺' : '人家'}暂时不知道该怎么回答这个问题。`,
        type: 'robot',
        robotName: user.selectedRobot
      };
    }

    logger.info(`从知识库中找到 ${knowledgeList.length} 条记录`);

    let bestMatch = null;
    let maxSimilarity = 0;

    for (const knowledge of knowledgeList) {
      try {
        if (!knowledge.vector) {
          logger.warn('知识条目缺少向量表示', { knowledgeId: knowledge._id, title: knowledge.title });
          continue;
        }

        // 确保向量是有效的格式
        const similarity = calculateSimilarity(userVector, knowledge.vector);
        logger.info('计算相似度结果', { 
          title: knowledge.title, 
          similarity, 
          vectorType: knowledge.vector instanceof Map ? 'Map' : typeof knowledge.vector
        });

        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestMatch = knowledge;
        }
      } catch (error) {
        logger.error('计算相似度失败:', error, { 
          knowledgeId: knowledge._id,
          title: knowledge.title
        });
        continue;
      }
    }

    // 如果找到相似度大于阈值的答案，使用该答案并根据机器人调整回复风格
    if (bestMatch && maxSimilarity > 0.2) {
      logger.info('找到匹配的答案', { 
        similarity: maxSimilarity,
        question: bestMatch.title,
        answer: bestMatch.content,
        knowledgeId: bestMatch._id
      });
      
      // 根据当前选择的机器人调整回复风格
      const content = exports.adjustReplyStyle(bestMatch.content, user.selectedRobot === '悉文' ? 'xiwen' : 'xihui');
      
      // 更新当前对话的标签
      const currentChat = await Chat.findOne({ userId }).sort({ createdAt: -1 });
      if (currentChat) {
        currentChat.tag = bestMatch.category;
        await currentChat.save();
      }
      
      return {
        _id: bestMatch._id,
        id: bestMatch._id,
        content: content,
        type: 'robot',
        robotName: user.selectedRobot
      };
    }

    // 如果没有找到合适的答案，返回默认回复
    logger.info('未找到匹配的答案，使用默认回复', { maxSimilarity });
    return {
      _id: null,
      id: null,
      content: `抱歉，${user.selectedRobot === '悉文' ? '俺' : '人家'}暂时不知道该怎么回答这个问题。`,
      type: 'robot',
      robotName: user.selectedRobot
    };
  } catch (error) {
    logger.error('获取机器人回复失败:', error);
    throw error;
  }
};

// 调整回复风格
exports.adjustReplyStyle = function(content, robotId) {
  if (robotId === 'xiwen') {
    // 悉文：更加男性化的回答方式
    return content
      .replace(/我/g, '俺')
      .replace(/您/g, '你')
      .replace(/请问/g, '问一下')
      .replace(/谢谢/g, '谢了')
      .replace(/不好意思/g, '抱歉')
      .replace(/麻烦/g, '帮个忙')
      .replace(/可以吗/g, '行不')
      .replace(/好的/g, '成');
  } else if (robotId === 'xihui') {
    // 悉荟：更加女性化的回答方式
    return content
      .replace(/我/g, '人家')
      .replace(/你/g, '亲')
      .replace(/请问/g, '麻烦问一下')
      .replace(/谢谢/g, '谢谢亲')
      .replace(/不好意思/g, '抱歉呢')
      .replace(/麻烦/g, '麻烦亲')
      .replace(/可以吗/g, '可以吗亲')
      .replace(/好的/g, '好的呢');
  }
  return content;
}

// 计算聊天积分
exports.calculateChatPoints = async (messageId) => {
  try {
    const chat = await Message.findById(messageId);
    if (!chat) {
      throw new Error('消息不存在');
    }

    // 根据消息长度和复杂度计算积分
    const basePoints = 1;
    const lengthPoints = Math.min(chat.content.length / 50, 2);
    const complexityPoints = chat.content.includes('?') || chat.content.includes('？') ? 1 : 0;
    
    return Math.round(basePoints + lengthPoints + complexityPoints);
  } catch (error) {
    logger.error('计算聊天积分失败:', error);
    throw error;
  }
};

// 获取聊天积分
exports.getChatPoints = async (userId, messageId) => {
  try {
    // 查找消息
    const message = await Message.findOne({
      _id: messageId,
      userId
    });

    if (!message) {
      throw new Error('消息不存在');
    }

    // 使用robotService获取机器人信息，避免ObjectId转换问题
    const robotId = message.robotId ? message.robotId.toString() : null;
    if (!robotId) {
      throw new Error('机器人ID不存在');
    }
    
    // 直接使用robotService获取机器人信息，它已经考虑了字符串ID的情况
    let robotInfo = null;
    try {
      robotInfo = await robotService.getRobotDetail(robotId);
    } catch (robotError) {
      logger.warn('获取机器人信息失败，使用默认配置', { robotId, error: robotError.message });
      // 尝试查找默认机器人
      const robots = await robotService.getRobotList();
      robotInfo = robots.find(r => r.name === robotId || r._id === robotId);
      
      if (!robotInfo) {
        throw new Error('机器人不存在');
      }
    }

    // 获取用户信息
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('用户不存在');
    }

    // 计算积分 - 固定为1点，简化处理
    const points = 1;

    // 更新用户积分
    user.points += points;
    await user.save();

    return {
      points,
      totalPoints: user.points
    };
  } catch (error) {
    logger.error('获取聊天积分失败:', error);
    throw error;
  }
};


// 获取机器人详情
exports.getRobotDetails = async (robotId) => {
  try {
    // 先按ID查询
    if (mongoose.Types.ObjectId.isValid(robotId)) {
      const robot = await Robot.findById(robotId);
      if (robot) return robot;
    }
    
    // 如果ID查询失败，按名称查询
    const robot = await Robot.findOne({ name: robotId });
    if (robot) return robot;
    
    logger.warn('获取机器人详情失败: 机器人不存在', { robotId });
    throw new Error('机器人不存在');
  } catch (error) {
    logger.error('获取机器人详情失败:', error);
    throw error;
  }
};