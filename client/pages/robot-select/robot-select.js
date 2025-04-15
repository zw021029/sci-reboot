const api = require('../../api/index');
const app = getApp();
const {Toast} = require('../../utils/toast');

Page({
  data: {
    hasUserInfo: false,
    isHasLogin: false,
    loading: false,
    robots: [],
    selectedRobot: null,
    currentRobotId: '',
    currentRobotIndex: 0,
  },

  async onLoad(options) {
    console.log('robot-select页面加载');
    await this.initPage(options);
  },

  async initPage(options) {
    try {
      // 获取token并校验是否已登录
      const token = wx.getStorageSync('token');
      console.log('当前token:', token ? '已存在' : '不存在');
      
      if (token) {
        this.setData({
          isHasLogin: true
        });
        await this.getUserInfo();
      }
      
      // 获取机器人列表
      await this.getRobots();
    } catch (error) {
      console.error('初始化页面失败:', error);
      Toast.fail('页面加载失败，请重试');
    }
  },

  async getUserInfo() {
    try {
      console.log('开始获取用户信息...');
      const res = await api.user.getUserInfo();
      console.log('获取用户信息响应:', JSON.stringify(res));
      
      if (res && res.data) {
        const userData = res.data;
        console.log('用户数据:', JSON.stringify(userData));
        
        // 标记获取成功
        this.setData({
          hasUserInfo: true
        });
        
        // 保存最新的用户信息到本地
        wx.setStorageSync('userInfo', userData);
        
        // 检查用户是否已绑定机器人
        const selectedRobot = userData.selectedRobot;
        console.log('用户已选择的机器人:', selectedRobot);
        
        if (selectedRobot) {
          console.log('用户已绑定机器人，准备跳转到聊天页面');
          setTimeout(() => {
            wx.reLaunch({
              url: '/pages/chat/chat',
              success: () => {
                console.log('成功跳转到聊天页面');
              },
              fail: (error) => {
                console.error('跳转聊天页面失败:', error);
              }
            });
          }, 500);
        }
      }
    } catch (error) {
      console.error('获取用户信息失败:', error);
    }
  },

  async getRobots() {
    Toast.showLoading('加载中...');
    try {
      const res = await api.robot.getRobotList();
      console.log('获取机器人列表响应:', JSON.stringify(res));
      
      if (res && res.data && res.data.length > 0) {
        // 添加personality属性用于区分不同机器人的个性化展示
        const robotsWithPersonality = res.data.map(robot => {
          const isMale = robot.name.includes('文') || robot.type === 'male';
          return {
            ...robot,
            personality: isMale ? 'male' : 'female',
            greeting: isMale ? '你好，我是悉文，很高兴认识你！我可以为你解答专业问题。' : '嗨，我是悉荟，很开心能帮到你！有任何问题都可以问我哦~'
          };
        });
        
        console.log('处理后的机器人列表:', JSON.stringify(robotsWithPersonality));
        
        this.setData({
          robots: robotsWithPersonality,
          selectedRobot: robotsWithPersonality[0],
          currentRobotId: robotsWithPersonality[0]._id,
          currentRobotIndex: 0
        });
      } else {
        console.error('机器人列表为空或格式不正确');
        Toast.fail('获取机器人列表失败');
      }
    } catch (error) {
      console.error('获取机器人列表失败:', error);
      Toast.fail('获取机器人列表失败');
    } finally {
      Toast.hideLoading();
    }
  },

  // 处理轮播图变化
  onSwiperChange(e) {
    const { current } = e.detail;
    const robot = this.data.robots[current];
    
    if (robot) {
      this.setData({
        currentRobotIndex: current,
        currentRobotId: robot._id,
        selectedRobot: robot
      });
    }
  },

  // 切换机器人
  switchRobot(e) {
    const index = e.currentTarget.dataset.index;
    const robot = this.data.robots[index];
    
    if (robot) {
      this.setData({
        currentRobotIndex: index,
        currentRobotId: robot._id,
        selectedRobot: robot
      });
    }
  },

  // 处理选择机器人
  handleSelect(e) {
    const robot = e.currentTarget.dataset.robot;
    if (robot) {
      this.setData({
        selectedRobot: robot,
        currentRobotId: robot._id,
        currentRobotIndex: this.data.robots.findIndex(r => r._id === robot._id)
      });
    }
  },

  // 处理绑定机器人
  async handleBind() {
    if (!this.data.selectedRobot) {
      Toast.fail('请先选择一个机器人');
      return;
    }

    // 未登录，需要先登录
    if (!this.data.isHasLogin) {
      wx.navigateTo({
        url: '/pages/login/login'
      });
      return;
    }

    Toast.showLoading('绑定中...');
    this.setData({
      loading: true
    });

    try {
      const robotId = this.data.selectedRobot._id;
      console.log('选择机器人，ID:', robotId);
      
      const res = await api.user.selectRobot(robotId);
      console.log('选择机器人响应:', res);
      
      // 更新本地存储的机器人和用户信息
      const app = getApp();
      app.globalData.selectedRobot = this.data.selectedRobot;
      wx.setStorageSync('selectedRobot', this.data.selectedRobot);
      
      // 更新用户信息中的selectedRobot字段
      let userInfo = wx.getStorageSync('userInfo');
      if (userInfo) {
        userInfo.selectedRobot = robotId;
        wx.setStorageSync('userInfo', userInfo);
      }
      
      Toast.success('选择成功');
      
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/chat/chat',
          success: () => {
            console.log('成功跳转到聊天页面');
          },
          fail: (error) => {
            console.error('跳转失败:', error);
            wx.reLaunch({
              url: '/pages/index/index'
            });
          }
        });
      }, 1000);
    } catch (error) {
      console.error('选择机器人失败:', error);
      Toast.fail(error.message || '选择失败');
    } finally {
      this.setData({
        loading: false
      });
      Toast.hideLoading();
    }
  }
}); 