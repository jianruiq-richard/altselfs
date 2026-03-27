import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            AltSelfs
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            投资人数字分身平台 - 让AI帮你预筛选项目，提高沟通效率，专注于真正有潜力的投资机会
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* 投资人入口 */}
          <div className="bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl transition-shadow duration-300">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">投资人入口</h2>
              <p className="text-gray-600 mb-8">
                创建你的数字分身，设定投资标准和沟通方式，让AI帮你初步筛选项目，节省宝贵时间
              </p>
              <Link
                href="/investor"
                className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors duration-200"
              >
                开始使用
              </Link>
            </div>
          </div>

          {/* 人选入口 */}
          <div className="bg-white rounded-2xl shadow-xl p-8 hover:shadow-2xl transition-shadow duration-300">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">人选入口</h2>
              <p className="text-gray-600 mb-8">
                与投资人的数字分身对话，完善你的项目想法，获得专业反馈，提高融资成功率
              </p>
              <Link
                href="/candidate"
                className="inline-block bg-green-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors duration-200"
              >
                开始对话
              </Link>
            </div>
          </div>
        </div>

        <div className="text-center mt-16">
          <p className="text-gray-500">
            还没有账户？<Link href="/sign-up" className="text-blue-600 hover:underline">立即注册</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
